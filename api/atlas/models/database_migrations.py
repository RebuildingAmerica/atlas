"""Database manager and SQLite migration helpers."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

__all__ = [
    "DatabaseManager",
    "_ensure_discovery_job_columns",
    "_ensure_discovery_run_columns",
    "_ensure_entry_columns",
    "_ensure_org_annotation_columns",
    "_ensure_org_coverage_target_columns",
    "_ensure_place_context_columns",
    "_ensure_place_related_place_columns",
    "_ensure_review_queue_columns",
    "db",
]


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
        ("linked_atproto_did", "ALTER TABLE entries ADD COLUMN linked_atproto_did TEXT"),
        ("linked_atproto_handle", "ALTER TABLE entries ADD COLUMN linked_atproto_handle TEXT"),
        (
            "linked_atproto_verified_at",
            "ALTER TABLE entries ADD COLUMN linked_atproto_verified_at TEXT",
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
        (
            "execution_mode",
            "ALTER TABLE discovery_jobs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'search'",
        ),
        (
            "input_payload",
            "ALTER TABLE discovery_jobs ADD COLUMN input_payload TEXT NOT NULL DEFAULT '{}'",
        ),
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


async def _ensure_place_related_place_columns(conn: Any) -> None:
    """Apply additive place-related-place migrations for local SQLite databases."""
    cursor = await conn.execute("PRAGMA table_info(place_related_places)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    additive_columns = (
        ("latitude", "ALTER TABLE place_related_places ADD COLUMN latitude REAL"),
        ("longitude", "ALTER TABLE place_related_places ADD COLUMN longitude REAL"),
        ("source_dataset", "ALTER TABLE place_related_places ADD COLUMN source_dataset TEXT"),
        ("source_identifier", "ALTER TABLE place_related_places ADD COLUMN source_identifier TEXT"),
        ("source_url", "ALTER TABLE place_related_places ADD COLUMN source_url TEXT"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)


async def _ensure_place_context_columns(conn: Any) -> None:
    """Apply additive place-context migrations for local SQLite databases."""
    cursor = await conn.execute("PRAGMA table_info(place_contexts)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    additive_columns = (
        ("source_dataset", "ALTER TABLE place_contexts ADD COLUMN source_dataset TEXT"),
        ("source_identifier", "ALTER TABLE place_contexts ADD COLUMN source_identifier TEXT"),
        ("source_url", "ALTER TABLE place_contexts ADD COLUMN source_url TEXT"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)


async def _ensure_org_coverage_target_columns(conn: Any) -> None:
    """Apply additive coverage-target migrations for customer delivery review state."""
    cursor = await conn.execute("PRAGMA table_info(org_coverage_targets)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    if "review_state" not in existing_columns:
        await conn.execute(
            """
            ALTER TABLE org_coverage_targets
            ADD COLUMN review_state TEXT NOT NULL DEFAULT 'needs_research'
            """
        )
