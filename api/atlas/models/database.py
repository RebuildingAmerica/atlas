"""
Database setup, schema management, and connection pooling.

Supports both SQLite (via aiosqlite) for local development and
PostgreSQL (via psycopg) for production deployments.
"""

from __future__ import annotations

import functools
import importlib.resources
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

import aiosqlite

if TYPE_CHECKING:
    from collections.abc import Sequence

logger = logging.getLogger(__name__)

__all__ = ["DB_SCHEMA", "DatabaseManager", "db", "get_db_connection", "init_db"]


class CursorProtocol(Protocol):  # pragma: no cover - typing-only protocol
    """Protocol for database cursor objects."""

    @property
    def description(self) -> Any: ...
    @property
    def rowcount(self) -> int: ...
    async def fetchall(self) -> list[tuple[Any, ...]]: ...
    async def fetchone(self) -> tuple[Any, ...] | None: ...


class ConnectionProtocol(Protocol):  # pragma: no cover - typing-only protocol
    """Protocol for database connection objects."""

    async def execute(self, sql: str, parameters: Sequence[Any] = ()) -> CursorProtocol: ...
    async def executemany(
        self, sql: str, parameters: Sequence[Sequence[Any]]
    ) -> CursorProtocol: ...
    async def commit(self) -> None: ...
    async def close(self) -> None: ...


def _is_postgres_url(database_url: str) -> bool:
    return database_url.startswith(("postgresql://", "postgres://"))


def _get_sqlite_path(database_url: str) -> str:
    if database_url.startswith("sqlite:///"):
        return database_url[10:]
    if database_url.startswith("sqlite://"):
        return database_url[9:]
    return database_url


@functools.lru_cache(maxsize=256)
def _translate_placeholders(sql: str) -> str:
    """Translate ? placeholders to %s for psycopg."""
    result = []
    in_single_quote = False
    in_double_quote = False
    i = 0
    while i < len(sql):
        char = sql[i]
        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
            result.append(char)
        elif char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            result.append(char)
        elif char == "?" and not in_single_quote and not in_double_quote:
            result.append("%s")
        else:
            result.append(char)
        i += 1
    return "".join(result)


class PostgresCursor:
    """Adapter that wraps a psycopg AsyncCursor to match the aiosqlite cursor interface."""

    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    @property
    def description(self) -> Any:
        return self._cursor.description

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount  # type: ignore[no-any-return]

    async def fetchall(self) -> list[tuple[Any, ...]]:
        return await self._cursor.fetchall()  # type: ignore[no-any-return]

    async def fetchone(self) -> tuple[Any, ...] | None:
        return await self._cursor.fetchone()  # type: ignore[no-any-return]


class PostgresConnection:
    """Adapter that wraps a psycopg AsyncConnection to match the aiosqlite interface."""

    backend = "postgres"

    def __init__(self, conn: Any) -> None:
        self._conn = conn

    async def execute(self, sql: str, parameters: Sequence[Any] = ()) -> PostgresCursor:
        translated = _translate_placeholders(sql)
        cursor = await self._conn.execute(translated, parameters or None)
        return PostgresCursor(cursor)

    async def executemany(self, sql: str, parameters: Sequence[Sequence[Any]]) -> PostgresCursor:
        translated = _translate_placeholders(sql)
        cursor = await self._conn.executemany(translated, parameters)
        return PostgresCursor(cursor)

    async def commit(self) -> None:
        await self._conn.commit()

    async def close(self) -> None:
        await self._conn.close()


async def get_db_connection(database_url: str, *, backend: str | None = None) -> Any:
    """
    Get an async database connection.

    Parameters
    ----------
    database_url : str
        Database URL.
    backend : str | None
        Explicit backend selection ("sqlite" or "postgres"). When None,
        falls back to URL-scheme detection for backwards compatibility
        with tests that don't pass a backend.

    Returns
    -------
    Connection adapter (PostgresConnection or aiosqlite.Connection)
    """
    use_postgres = backend == "postgres" if backend else _is_postgres_url(database_url)
    if use_postgres:
        import psycopg

        conn = await psycopg.AsyncConnection.connect(database_url, autocommit=False)
        return PostgresConnection(conn)

    db_path = _get_sqlite_path(database_url)
    sqlite_conn = await aiosqlite.connect(db_path)
    await sqlite_conn.execute("PRAGMA foreign_keys = ON")
    await sqlite_conn.execute("PRAGMA journal_mode = WAL")
    return sqlite_conn


async def init_db(database_url: str, *, backend: str | None = None) -> None:
    """
    Initialize the database schema.

    Creates all tables and indexes if they don't exist. Safe to call
    multiple times (idempotent).

    Parameters
    ----------
    database_url : str
        Database URL.
    backend : str | None
        Explicit backend selection ("sqlite" or "postgres"). Falls back
        to URL-scheme detection when None.
    """
    use_postgres = backend == "postgres" if backend else _is_postgres_url(database_url)
    if use_postgres:
        await _init_postgres(database_url)
    else:
        await _init_sqlite(database_url)


async def _init_postgres(database_url: str) -> None:  # pragma: no cover - PG-only path
    """Initialize PostgreSQL schema."""
    import psycopg

    conn = await psycopg.AsyncConnection.connect(database_url, autocommit=False)
    try:
        schema_sql = _load_postgres_schema()
        await conn.execute(schema_sql)
        await conn.commit()
        logger.info("PostgreSQL schema initialized successfully")
    except Exception:
        await conn.rollback()
        logger.exception("Failed to initialize PostgreSQL database")
        raise
    finally:
        await conn.close()


def _load_postgres_schema() -> str:
    """Load the PostgreSQL schema from the bundled SQL file."""
    schema_path = importlib.resources.files("atlas.models") / "schema.sql"
    return schema_path.read_text(encoding="utf-8")


async def _init_sqlite(database_url: str) -> None:
    """Initialize SQLite schema.

    Runs column migrations before the full schema script so that indexes
    and triggers referencing new columns don't fail on existing databases.
    """
    conn = await get_db_connection(database_url)
    try:
        await _ensure_entry_columns(conn)
        await _ensure_discovery_run_columns(conn)
        await _ensure_discovery_job_columns(conn)
        await _ensure_review_queue_columns(conn)
        await _ensure_org_annotation_columns(conn)
        await conn.commit()
        await conn.executescript(DB_SCHEMA)
        await conn.commit()
        logger.info("SQLite schema initialized successfully")
    except Exception:
        logger.exception("Failed to initialize SQLite database")
        raise
    finally:
        await conn.close()


# Full SQLite schema with FTS5 and proper indexes (kept for local development)
DB_SCHEMA = """
-- Enable extensions
PRAGMA foreign_keys = ON;

-- Entries table (core entity)
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('person', 'organization', 'initiative', 'campaign', 'event')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    state TEXT,
    region TEXT,
    geo_specificity TEXT NOT NULL CHECK(geo_specificity IN ('local', 'regional', 'statewide', 'national')),
    latitude REAL,
    longitude REAL,
    geocode_precision TEXT,
    geocode_source TEXT,
    full_address TEXT,
    website TEXT,
    email TEXT,
    phone TEXT,
    social_media TEXT,
    affiliated_org_id TEXT,
    active BOOLEAN NOT NULL DEFAULT 1,
    verified BOOLEAN NOT NULL DEFAULT 0,
    last_verified DATE,
    contact_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK(contact_status IN ('not_contacted', 'contacted', 'responded', 'confirmed', 'declined')),
    editorial_notes TEXT,
    priority TEXT CHECK(priority IS NULL OR priority IN ('high', 'medium', 'low')),
    first_seen DATE NOT NULL,
    last_seen DATE NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    slug TEXT UNIQUE,
    photo_url TEXT,
    custom_bio TEXT,
    claim_status TEXT NOT NULL DEFAULT 'unclaimed' CHECK(claim_status IN ('unclaimed', 'pending', 'verified', 'revoked')),
    claimed_by_user_id TEXT,
    claim_verified_at DATETIME,
    last_confirmed_at DATETIME,
    suppressed_source_ids TEXT,
    preferred_contact_channel TEXT,
    FOREIGN KEY (affiliated_org_id) REFERENCES entries(id)
);

-- Profile claims (subject ownership of profiles)
CREATE TABLE IF NOT EXISTS profile_claims (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected', 'revoked')),
    tier INTEGER NOT NULL DEFAULT 1 CHECK(tier IN (1, 2)),
    evidence_json TEXT,
    verification_token TEXT,
    verification_token_expires_at DATETIME,
    verified_at DATETIME,
    rejected_reason TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Saved profile lists (signed-in user collections)
CREATE TABLE IF NOT EXISTS saved_lists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

-- List membership (entries pinned to a list)
CREATE TABLE IF NOT EXISTS saved_list_items (
    list_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    note TEXT,
    added_at DATETIME NOT NULL,
    PRIMARY KEY (list_id, entry_id),
    FOREIGN KEY (list_id) REFERENCES saved_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Profile follow subscriptions (notify on new sources)
CREATE TABLE IF NOT EXISTS profile_follows (
    user_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    subscribed_to TEXT NOT NULL DEFAULT 'sources' CHECK(subscribed_to IN ('sources', 'all')),
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, entry_id),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Sources table (web sources, articles, etc.)
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    publication TEXT,
    published_date DATE,
    type TEXT NOT NULL CHECK(type IN ('news_article', 'op_ed', 'podcast', 'academic_paper', 'government_record', 'social_media', 'community_archive', 'org_website', 'conference', 'video', 'report', 'other')),
    ingested_at DATETIME NOT NULL,
    extraction_method TEXT NOT NULL CHECK(extraction_method IN ('manual', 'ai_assisted', 'autodiscovery')),
    raw_content TEXT,
    created_at DATETIME NOT NULL
);

-- Junction: entries to sources (many-to-many)
CREATE TABLE IF NOT EXISTS entry_sources (
    entry_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    extraction_context TEXT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (entry_id, source_id),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Junction: entries to issue areas (many-to-many)
CREATE TABLE IF NOT EXISTS entry_issue_areas (
    entry_id TEXT NOT NULL,
    issue_area TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (entry_id, issue_area),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Stable identity keys keep repeated public mentions attached to one actor.
CREATE TABLE IF NOT EXISTS entity_identity_keys (
    entry_id TEXT NOT NULL,
    key_type TEXT NOT NULL CHECK(key_type IN ('ein', 'fec_id', 'domain')),
    key_value TEXT NOT NULL,
    source_id TEXT,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (key_type, key_value),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

-- Sourced relationship edges make the profile network inspectable and durable.
CREATE TABLE IF NOT EXISTS entity_relationship_edges (
    id TEXT PRIMARY KEY,
    source_entry_id TEXT NOT NULL,
    target_entry_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    evidence_label TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    evidence_count INTEGER NOT NULL DEFAULT 1 CHECK(evidence_count > 0),
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CHECK(source_entry_id != target_entry_id),
    UNIQUE(source_entry_id, target_entry_id, relationship_type, source_id),
    FOREIGN KEY (source_entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Outreach log (internal)
CREATE TABLE IF NOT EXISTS outreach_logs (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    date DATETIME NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('email', 'phone', 'social_media', 'in_person', 'other')),
    notes TEXT,
    response TEXT CHECK(response IS NULL OR response IN ('no_response', 'positive', 'negative', 'deferred')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Episode associations (internal)
CREATE TABLE IF NOT EXISTS episode_associations (
    entry_id TEXT NOT NULL,
    episode TEXT NOT NULL,
    role TEXT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (entry_id, episode),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Discovery runs (pipeline execution tracking)
CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    location_query TEXT NOT NULL,
    state TEXT NOT NULL,
    issue_areas TEXT NOT NULL,
    research_goal TEXT NOT NULL DEFAULT 'landscape_scan',
    queries_generated INTEGER NOT NULL DEFAULT 0,
    sources_fetched INTEGER NOT NULL DEFAULT 0,
    sources_processed INTEGER NOT NULL DEFAULT 0,
    entries_extracted INTEGER NOT NULL DEFAULT 0,
    entries_after_dedup INTEGER NOT NULL DEFAULT 0,
    entries_confirmed INTEGER NOT NULL DEFAULT 0,
    research_summary TEXT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_run_syncs (
    id TEXT PRIMARY KEY,
    local_run_id TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    remote_run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    actor_email TEXT,
    sync_status TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    synced_at DATETIME,
    UNIQUE(local_run_id, artifact_hash)
);

-- Entity flags (anonymous public flagging)
CREATE TABLE IF NOT EXISTS entity_flags (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'resolved')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Source flags (anonymous public flagging)
CREATE TABLE IF NOT EXISTS source_flags (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'resolved')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Review queue (pre-publication staging for discovered records)
CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    entity_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    hold_reason TEXT NOT NULL,
    score REAL,
    dedup_suspect BOOLEAN NOT NULL DEFAULT 0,
    dedup_note TEXT,
    created_at DATETIME NOT NULL,
    reviewed_at DATETIME,
    reviewed_by TEXT
);

-- Resource ownership (organization attribution and visibility)
CREATE TABLE IF NOT EXISTS resource_ownership (
    resource_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('entry', 'source', 'discovery_run')),
    org_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (resource_id, resource_type)
);

-- Organization annotations (private notes on shared entries)
CREATE TABLE IF NOT EXISTS org_annotations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    entry_id TEXT,
    source_id TEXT,
    target_type TEXT NOT NULL DEFAULT 'entry' CHECK(target_type IN ('entry', 'source')),
    target_id TEXT,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (entry_id) REFERENCES entries(id),
    FOREIGN KEY (source_id) REFERENCES sources(id)
);

-- Verified custom domains for public workspace directories.
CREATE TABLE IF NOT EXISTS org_directory_domains (
    org_id TEXT PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    verification_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    verified_at TEXT
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    name,
    description,
    content=entries,
    content_rowid=rowid
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entries_state ON entries(state);
CREATE INDEX IF NOT EXISTS idx_entries_city ON entries(city);
CREATE INDEX IF NOT EXISTS idx_entries_region ON entries(region);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_active ON entries(active);
CREATE INDEX IF NOT EXISTS idx_entries_verified ON entries(verified);
CREATE INDEX IF NOT EXISTS idx_entries_state_city ON entries(state, city);
CREATE INDEX IF NOT EXISTS idx_entries_lat_lng ON entries(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_entry_sources_entry_id ON entry_sources(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_sources_source_id ON entry_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_entry_id ON entry_issue_areas(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_issue_area ON entry_issue_areas(issue_area);
CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_entry ON entity_identity_keys(entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_source ON entity_identity_keys(source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_source_entry
    ON entity_relationship_edges(source_entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_target_entry
    ON entity_relationship_edges(target_entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_source
    ON entity_relationship_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_entry_id ON outreach_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_date ON outreach_logs(date);
CREATE INDEX IF NOT EXISTS idx_episode_assoc_entry_id ON episode_associations(entry_id);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_state ON discovery_runs(state);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_run_syncs_local_run_id ON discovery_run_syncs(local_run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_run_syncs_remote_run_id ON discovery_run_syncs(remote_run_id);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
CREATE INDEX IF NOT EXISTS idx_sources_ingested ON sources(ingested_at);
CREATE INDEX IF NOT EXISTS idx_entity_flags_entity_id ON entity_flags(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_flags_status ON entity_flags(status);
CREATE INDEX IF NOT EXISTS idx_source_flags_source_id ON source_flags(source_id);
CREATE INDEX IF NOT EXISTS idx_source_flags_status ON source_flags(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_entity_id ON review_queue(entity_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_org_status ON review_queue(org_id, status);
CREATE INDEX IF NOT EXISTS idx_resource_ownership_org ON resource_ownership(org_id);
CREATE INDEX IF NOT EXISTS idx_resource_ownership_org_visibility ON resource_ownership(org_id, visibility);
CREATE INDEX IF NOT EXISTS idx_org_annotations_org ON org_annotations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_annotations_entry ON org_annotations(entry_id);
CREATE INDEX IF NOT EXISTS idx_org_annotations_source ON org_annotations(source_id);
CREATE INDEX IF NOT EXISTS idx_org_annotations_target ON org_annotations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_org_directory_domains_status ON org_directory_domains(status);
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);
CREATE INDEX IF NOT EXISTS idx_entries_claim_status ON entries(claim_status);
CREATE INDEX IF NOT EXISTS idx_entries_claimed_by ON entries(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_entry ON profile_claims(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_user ON profile_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_status ON profile_claims(status);
CREATE INDEX IF NOT EXISTS idx_profile_claims_token ON profile_claims(verification_token);
CREATE INDEX IF NOT EXISTS idx_saved_lists_user ON saved_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_list_items_entry ON saved_list_items(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_follows_entry ON profile_follows(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_follows_user ON profile_follows(user_id);

-- Discovery jobs (durable pipeline execution tracking)
CREATE TABLE IF NOT EXISTS discovery_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled')),
    progress TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    claimed_by TEXT,
    claimed_until DATETIME,
    idempotency_key TEXT,
    next_attempt_at DATETIME,
    created_at DATETIME NOT NULL,
    started_at DATETIME,
    completed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status ON discovery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_run_id ON discovery_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_claimed_until ON discovery_jobs(claimed_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_jobs_idempotency ON discovery_jobs(idempotency_key);

-- Cost ledger (per-call metering for discovery spend ceilings + kill switch)
CREATE TABLE IF NOT EXISTS cost_ledger (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES discovery_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    units REAL NOT NULL,
    estimated_cost REAL NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_run_id ON cost_ledger(run_id);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_created_at ON cost_ledger(created_at);

-- Tenant discovery budgets (monthly run starts per workspace)
CREATE TABLE IF NOT EXISTS org_discovery_budgets (
    org_id TEXT NOT NULL,
    month TEXT NOT NULL,
    monthly_run_limit INTEGER NOT NULL CHECK(monthly_run_limit >= 0),
    used_runs INTEGER NOT NULL DEFAULT 0 CHECK(used_runs >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (org_id, month)
);
CREATE INDEX IF NOT EXISTS idx_org_discovery_budgets_org ON org_discovery_budgets(org_id);

-- Discovery schedules (autonomous pipeline targets)
CREATE TABLE IF NOT EXISTS discovery_schedules (
    id TEXT PRIMARY KEY,
    location_query TEXT NOT NULL,
    state TEXT NOT NULL,
    issue_areas TEXT NOT NULL,
    search_depth TEXT NOT NULL DEFAULT 'standard' CHECK(search_depth IN ('standard', 'deep')),
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_id TEXT REFERENCES discovery_runs(id),
    last_run_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_enabled ON discovery_schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_state ON discovery_schedules(state);

-- Slug aliases (for vanity slug redirects)
CREATE TABLE IF NOT EXISTS slug_aliases (
    old_slug TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slug_aliases_entry_id ON slug_aliases(entry_id);

-- Keep FTS content synchronized with entries.
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, name, description)
    VALUES ('delete', old.rowid, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, name, description)
    VALUES ('delete', old.rowid, old.name, old.description);
    INSERT INTO entries_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
END;

-- Ensure existing rows are discoverable after init_db runs on an existing database.
INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');
"""


class DatabaseManager:
    """Helper class for database operations."""

    @staticmethod
    def generate_uuid() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def now_iso() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def encode_json(data: object) -> str:
        return json.dumps(data)

    @staticmethod
    def decode_json(data: str) -> object:
        return json.loads(data)


# Export manager for use in CRUD operations
db = DatabaseManager()


async def _ensure_entry_columns(conn: Any) -> None:
    """Apply additive entry-table migrations for local SQLite databases.

    Safe to call before the full schema script — returns early if the
    entries table doesn't exist yet (fresh database).
    """
    cursor = await conn.execute("PRAGMA table_info(entries)")
    rows = await cursor.fetchall()
    if not rows:
        return  # Table doesn't exist yet; full schema will create it with all columns.
    existing_columns = {row[1] for row in rows}

    additive_columns = (
        ("full_address", "ALTER TABLE entries ADD COLUMN full_address TEXT"),
        ("slug", "ALTER TABLE entries ADD COLUMN slug TEXT"),
        ("photo_url", "ALTER TABLE entries ADD COLUMN photo_url TEXT"),
        ("custom_bio", "ALTER TABLE entries ADD COLUMN custom_bio TEXT"),
        (
            "claim_status",
            "ALTER TABLE entries ADD COLUMN claim_status TEXT NOT NULL DEFAULT 'unclaimed'",
        ),
        ("claimed_by_user_id", "ALTER TABLE entries ADD COLUMN claimed_by_user_id TEXT"),
        ("claim_verified_at", "ALTER TABLE entries ADD COLUMN claim_verified_at DATETIME"),
        ("last_confirmed_at", "ALTER TABLE entries ADD COLUMN last_confirmed_at DATETIME"),
        ("suppressed_source_ids", "ALTER TABLE entries ADD COLUMN suppressed_source_ids TEXT"),
        (
            "preferred_contact_channel",
            "ALTER TABLE entries ADD COLUMN preferred_contact_channel TEXT",
        ),
        ("latitude", "ALTER TABLE entries ADD COLUMN latitude REAL"),
        ("longitude", "ALTER TABLE entries ADD COLUMN longitude REAL"),
        ("geocode_precision", "ALTER TABLE entries ADD COLUMN geocode_precision TEXT"),
        ("geocode_source", "ALTER TABLE entries ADD COLUMN geocode_source TEXT"),
    )
    # Indexes that must follow their backing column when it is freshly added.
    follow_up_indexes = {
        "slug": "CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug)",
        "geocode_source": (
            "CREATE INDEX IF NOT EXISTS idx_entries_lat_lng ON entries(latitude, longitude)"
        ),
    }

    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)
            index_ddl = follow_up_indexes.get(column)
            if index_ddl is not None:
                await conn.execute(index_ddl)


async def _ensure_discovery_run_columns(conn: Any) -> None:
    """Apply additive discovery-run migrations for stored research outputs."""
    cursor = await conn.execute("PRAGMA table_info(discovery_runs)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    if "research_goal" not in existing_columns:
        await conn.execute(
            """
            ALTER TABLE discovery_runs
            ADD COLUMN research_goal TEXT NOT NULL DEFAULT 'landscape_scan'
            """
        )
    if "research_summary" not in existing_columns:
        await conn.execute("ALTER TABLE discovery_runs ADD COLUMN research_summary TEXT")


async def _ensure_discovery_job_columns(conn: Any) -> None:
    """Apply additive discovery-job migrations before index creation."""
    cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    additive_columns = (
        ("idempotency_key", "ALTER TABLE discovery_jobs ADD COLUMN idempotency_key TEXT"),
        ("next_attempt_at", "ALTER TABLE discovery_jobs ADD COLUMN next_attempt_at DATETIME"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)


async def _ensure_review_queue_columns(conn: Any) -> None:
    """Apply additive review-queue migrations for tenant moderation boundaries."""
    cursor = await conn.execute("PRAGMA table_info(review_queue)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    if "org_id" not in existing_columns:
        await conn.execute("ALTER TABLE review_queue ADD COLUMN org_id TEXT")

    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_queue_org_status ON review_queue(org_id, status)"
    )


async def _ensure_org_annotation_columns(conn: Any) -> None:
    """Apply SQLite migrations for typed private notes on entries and sources."""
    cursor = await conn.execute("PRAGMA table_info(org_annotations)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    entry_column = next((row for row in rows if row[1] == "entry_id"), None)
    entry_is_not_null = bool(entry_column and entry_column[3])

    if entry_is_not_null:
        await conn.execute("ALTER TABLE org_annotations RENAME TO org_annotations_legacy")
        await conn.execute(
            """
            CREATE TABLE org_annotations (
                id TEXT PRIMARY KEY,
                org_id TEXT NOT NULL,
                entry_id TEXT,
                source_id TEXT,
                target_type TEXT NOT NULL DEFAULT 'entry'
                    CHECK(target_type IN ('entry', 'source')),
                target_id TEXT,
                content TEXT NOT NULL,
                author_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                FOREIGN KEY (entry_id) REFERENCES entries(id),
                FOREIGN KEY (source_id) REFERENCES sources(id)
            )
            """
        )
        await conn.execute(
            """
            INSERT INTO org_annotations (
                id, org_id, entry_id, source_id, target_type, target_id,
                content, author_id, created_at, updated_at
            )
            SELECT
                id, org_id, entry_id, NULL, 'entry', entry_id,
                content, author_id, created_at, updated_at
            FROM org_annotations_legacy
            """
        )
        await conn.execute("DROP TABLE org_annotations_legacy")
        existing_columns = {
            "id",
            "org_id",
            "entry_id",
            "source_id",
            "target_type",
            "target_id",
            "content",
            "author_id",
            "created_at",
            "updated_at",
        }

    additive_columns = (
        ("source_id", "ALTER TABLE org_annotations ADD COLUMN source_id TEXT"),
        (
            "target_type",
            "ALTER TABLE org_annotations ADD COLUMN target_type TEXT NOT NULL DEFAULT 'entry'",
        ),
        ("target_id", "ALTER TABLE org_annotations ADD COLUMN target_id TEXT"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)

    await conn.execute("UPDATE org_annotations SET target_type = 'entry' WHERE target_type IS NULL")
    await conn.execute(
        "UPDATE org_annotations SET target_id = entry_id "
        "WHERE target_id IS NULL AND entry_id IS NOT NULL"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_annotations_source ON org_annotations(source_id)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_annotations_target "
        "ON org_annotations(target_type, target_id)"
    )
