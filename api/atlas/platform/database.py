"""
Database setup, schema management, and connection pooling.

Provides SQLite database initialization with full schema including FTS5
full-text search capabilities and proper indexes.
"""

import json
import logging
import uuid
from datetime import UTC, datetime

import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["DB_SCHEMA", "get_db_connection", "init_db"]


def _get_db_path(database_url: str) -> str:
    """
    Extract file path from database URL.

    Parameters
    ----------
    database_url : str
        Database URL (e.g., "sqlite:///atlas.db").

    Returns
    -------
    str
        The file path (e.g., "atlas.db").
    """
    if database_url.startswith("sqlite:///"):
        return database_url[10:]
    if database_url.startswith("sqlite://"):
        return database_url[9:]
    return database_url


async def get_db_connection(database_url: str) -> aiosqlite.Connection:
    """
    Get an async SQLite connection.

    Parameters
    ----------
    database_url : str
        Database URL (e.g., "sqlite:///atlas.db").

    Returns
    -------
    aiosqlite.Connection
        An async SQLite connection.
    """
    db_path = _get_db_path(database_url)
    conn = await aiosqlite.connect(db_path)
    await conn.execute("PRAGMA foreign_keys = ON")
    await conn.execute("PRAGMA journal_mode = WAL")
    return conn


async def init_db(database_url: str) -> None:
    """
    Initialize the database schema.

    Creates all tables and indexes if they don't exist. Safe to call
    multiple times (idempotent).

    Parameters
    ----------
    database_url : str
        Database URL (e.g., "sqlite:///atlas.db").
    """
    conn = await get_db_connection(database_url)
    try:
        await conn.executescript(DB_SCHEMA)
        await _ensure_entry_columns(conn)
        await conn.commit()
        logger.info("Database schema initialized successfully")
    except Exception:
        logger.exception("Failed to initialize database")
        raise
    finally:
        await conn.close()


# Full SQLite schema with FTS5 and proper indexes
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

-- Anonymous public flags for stale or incorrect records.
CREATE TABLE IF NOT EXISTS entity_flags (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_flags (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
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
CREATE INDEX IF NOT EXISTS idx_source_flags_source_id ON source_flags(source_id);

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
        """
        Generate a UUID for database records.

        Returns
        -------
        str
            A new UUID as a string.
        """
        return str(uuid.uuid4())

    @staticmethod
    def now_iso() -> str:
        """
        Get the current time in ISO format.

        Returns
        -------
        str
            Current datetime in ISO 8601 format with UTC timezone.
        """
        return datetime.now(UTC).isoformat()

    @staticmethod
    def encode_json(data: object) -> str:
        """
        Encode Python object as JSON for storage.

        Parameters
        ----------
        data : object
            The data to encode.

        Returns
        -------
        str
            JSON string.
        """
        return json.dumps(data)

    @staticmethod
    def decode_json(data: str) -> object:
        """
        Decode JSON from storage.

        Parameters
        ----------
        data : str
            JSON string.

        Returns
        -------
        object
            Decoded Python object.
        """
        return json.loads(data)


# Export manager for use in CRUD operations
db = DatabaseManager()


async def _ensure_entry_columns(conn: aiosqlite.Connection) -> None:
    """Apply additive entry-table migrations for local databases."""
    cursor = await conn.execute("PRAGMA table_info(entries)")
    rows = await cursor.fetchall()
    existing_columns = {row[1] for row in rows}

    if "full_address" not in existing_columns:
        await conn.execute("ALTER TABLE entries ADD COLUMN full_address TEXT")
