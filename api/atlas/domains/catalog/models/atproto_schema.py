"""ATProto profile-linking schema helpers."""

from __future__ import annotations

from typing import Any

from atlas.models.database import get_db_connection

ATPROTO_IDENTITY_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS atproto_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    did TEXT NOT NULL,
    current_handle TEXT NOT NULL,
    pds_url TEXT,
    did_resolved_at TEXT NOT NULL,
    handle_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, did)
)
"""

ATPROTO_IDENTITY_POSTGRES_DDL = """
CREATE TABLE IF NOT EXISTS atproto_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    did TEXT NOT NULL,
    current_handle TEXT NOT NULL,
    pds_url TEXT,
    did_resolved_at TIMESTAMPTZ NOT NULL,
    handle_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id, did)
)
"""

ATPROTO_IDENTITY_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_atproto_identities_user ON atproto_identities(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_atproto_identities_did ON atproto_identities(did)",
)

ENTRY_ATPROTO_SQLITE_COLUMNS = (
    ("linked_atproto_did", "ALTER TABLE entries ADD COLUMN linked_atproto_did TEXT"),
    ("linked_atproto_handle", "ALTER TABLE entries ADD COLUMN linked_atproto_handle TEXT"),
    (
        "linked_atproto_verified_at",
        "ALTER TABLE entries ADD COLUMN linked_atproto_verified_at TEXT",
    ),
)

ENTRY_ATPROTO_POSTGRES_COLUMNS = (
    "ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_atproto_did TEXT",
    "ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_atproto_handle TEXT",
    "ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_atproto_verified_at TIMESTAMPTZ",
)


async def ensure_atproto_profile_schema(database_url: str) -> None:
    """Initialize ATProto identity storage and profile-linking columns.

    Parameters
    ----------
    database_url
        Database URL for the Atlas catalog database.
    """
    conn = await get_db_connection(database_url)
    try:
        await ensure_atproto_identity_schema(conn)
        await ensure_entry_atproto_columns(conn)
        await conn.commit()
    finally:
        await conn.close()


async def ensure_atproto_identity_schema(conn: Any) -> None:
    """Create the linked-identity table used by profile verification.

    Parameters
    ----------
    conn
        Open Atlas database connection.
    """
    if _uses_postgres(conn):
        await conn.execute(ATPROTO_IDENTITY_POSTGRES_DDL)
    else:
        await conn.execute(ATPROTO_IDENTITY_SQLITE_DDL)
    for ddl in ATPROTO_IDENTITY_INDEXES:
        await conn.execute(ddl)


async def ensure_entry_atproto_columns(conn: Any) -> None:
    """Add public profile ATProto link columns when needed.

    Parameters
    ----------
    conn
        Open Atlas database connection.
    """
    if _uses_postgres(conn):
        for ddl in ENTRY_ATPROTO_POSTGRES_COLUMNS:
            await conn.execute(ddl)
        return

    cursor = await conn.execute("PRAGMA table_info(entries)")
    rows = await cursor.fetchall()
    if not rows:
        return
    existing_columns = {row[1] for row in rows}
    for column, ddl in ENTRY_ATPROTO_SQLITE_COLUMNS:
        if column not in existing_columns:
            await conn.execute(ddl)


def _uses_postgres(conn: Any) -> bool:
    return getattr(conn, "backend", None) == "postgres"
