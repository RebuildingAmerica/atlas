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


class CursorProtocol(Protocol):
    """Protocol for database cursor objects."""

    @property
    def description(self) -> Any: ...
    @property
    def rowcount(self) -> int: ...
    async def fetchall(self) -> list[tuple[Any, ...]]: ...
    async def fetchone(self) -> tuple[Any, ...] | None: ...


class ConnectionProtocol(Protocol):
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


async def get_db_connection(database_url: str) -> Any:
    """
    Get an async database connection.

    Automatically selects the appropriate backend based on the URL scheme:
    - postgresql:// or postgres:// → psycopg AsyncConnection
    - sqlite:/// → aiosqlite Connection

    Parameters
    ----------
    database_url : str
        Database URL.

    Returns
    -------
    Connection adapter (PostgresConnection or aiosqlite.Connection)
    """
    if _is_postgres_url(database_url):
        import psycopg

        conn = await psycopg.AsyncConnection.connect(database_url, autocommit=False)
        return PostgresConnection(conn)

    db_path = _get_sqlite_path(database_url)
    sqlite_conn = await aiosqlite.connect(db_path)
    await sqlite_conn.execute("PRAGMA foreign_keys = ON")
    await sqlite_conn.execute("PRAGMA journal_mode = WAL")
    return sqlite_conn


async def init_db(database_url: str) -> None:
    """
    Initialize the database schema.

    Creates all tables and indexes if they don't exist. Safe to call
    multiple times (idempotent).

    Parameters
    ----------
    database_url : str
        Database URL.
    """
    if _is_postgres_url(database_url):
        await _init_postgres(database_url)
    else:
        await _init_sqlite(database_url)


async def _init_postgres(database_url: str) -> None:
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
    """Initialize SQLite schema."""
    conn = await get_db_connection(database_url)
    try:
        await conn.executescript(DB_SCHEMA)
        await _ensure_entry_columns(conn)
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
    FOREIGN KEY (affiliated_org_id) REFERENCES entries(id)
);

-- Sources table (web sources, articles, etc.)
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    publication TEXT,
    published_date DATE,
    type TEXT NOT NULL CHECK(type IN ('news_article', 'op_ed', 'podcast', 'academic_paper', 'government_record', 'social_media', 'org_website', 'conference', 'video', 'report', 'other')),
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
    queries_generated INTEGER NOT NULL DEFAULT 0,
    sources_fetched INTEGER NOT NULL DEFAULT 0,
    sources_processed INTEGER NOT NULL DEFAULT 0,
    entries_extracted INTEGER NOT NULL DEFAULT 0,
    entries_after_dedup INTEGER NOT NULL DEFAULT 0,
    entries_confirmed INTEGER NOT NULL DEFAULT 0,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at DATETIME NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_entry_sources_entry_id ON entry_sources(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_sources_source_id ON entry_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_entry_id ON entry_issue_areas(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_issue_area ON entry_issue_areas(issue_area);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_entry_id ON outreach_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_date ON outreach_logs(date);
CREATE INDEX IF NOT EXISTS idx_episode_assoc_entry_id ON episode_associations(entry_id);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_state ON discovery_runs(state);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
CREATE INDEX IF NOT EXISTS idx_sources_ingested ON sources(ingested_at);
CREATE INDEX IF NOT EXISTS idx_entity_flags_entity_id ON entity_flags(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_flags_status ON entity_flags(status);
CREATE INDEX IF NOT EXISTS idx_source_flags_source_id ON source_flags(source_id);
CREATE INDEX IF NOT EXISTS idx_source_flags_status ON source_flags(status);

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
    """Apply additive entry-table migrations for local SQLite databases."""
    cursor = await conn.execute("PRAGMA table_info(entries)")
    rows = await cursor.fetchall()
    existing_columns = {row[1] for row in rows}

    if "full_address" not in existing_columns:
        await conn.execute("ALTER TABLE entries ADD COLUMN full_address TEXT")
