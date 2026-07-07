"""Daemon lifecycle state: single-row status/heartbeat/tick tracking."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import now, serialize_timestamp

if TYPE_CHECKING:
    from datetime import datetime

    from atlas_scout.store.db import Database

_CREATE_DAEMON_STATE = """
CREATE TABLE IF NOT EXISTS daemon_state (
    key TEXT PRIMARY KEY CHECK(key = 'scout'),
    status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('starting', 'running', 'stopped')),
    started_at TEXT,
    last_heartbeat_at TEXT,
    config_path TEXT,
    profile_name TEXT,
    process_id INTEGER,
    target_count INTEGER NOT NULL DEFAULT 0 CHECK(target_count >= 0),
    interval_seconds INTEGER,
    interval_basis TEXT,
    last_tick_summary TEXT,
    updated_at TEXT NOT NULL
)
"""

_DAEMON_STATE_KEY = "scout"


def _validate_target_count(target_count: int) -> int:
    """Validate the daemon target count before persisting it."""
    if target_count < 0:
        raise ValueError("target_count must be non-negative")
    return target_count


def _validate_process_id(process_id: int | None) -> int | None:
    """Validate an optional daemon process identifier."""
    if process_id is not None and process_id <= 0:
        raise ValueError("process_id must be positive")
    return process_id


def _validate_interval_seconds(interval_seconds: int | None) -> int | None:
    """Validate an optional daemon interval in seconds."""
    if interval_seconds is not None and interval_seconds < 0:
        raise ValueError("interval_seconds must be non-negative")
    return interval_seconds


class DaemonStateRepository:
    """Persists the single-row daemon lifecycle state."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create or migrate the daemon_state table to enforce current constraints."""
        conn = self._db.connection
        await conn.execute(_CREATE_DAEMON_STATE)
        async with conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'daemon_state'"
        ) as cursor:
            row = await cursor.fetchone()

        schema_sql = str(row["sql"]) if row is not None else ""
        if "target_count >= 0" not in schema_sql or "'starting'" not in schema_sql:
            await conn.execute("ALTER TABLE daemon_state RENAME TO daemon_state_legacy")
            await conn.execute(_CREATE_DAEMON_STATE)
            await conn.execute(
                """
                INSERT INTO daemon_state (
                    key,
                    status,
                    started_at,
                    last_heartbeat_at,
                    config_path,
                    profile_name,
                    process_id,
                    target_count,
                    interval_seconds,
                    interval_basis,
                    last_tick_summary,
                    updated_at
                )
                SELECT
                    key,
                    status,
                    started_at,
                    last_heartbeat_at,
                    config_path,
                    profile_name,
                    NULL,
                    CASE
                        WHEN target_count < 0 THEN 0
                        ELSE target_count
                    END,
                    NULL,
                    NULL,
                    last_tick_summary,
                    updated_at
                FROM daemon_state_legacy
                """
            )
            await conn.execute("DROP TABLE daemon_state_legacy")

        async with conn.execute("PRAGMA table_info(daemon_state)") as cursor:
            rows = await cursor.fetchall()
        existing_columns = {str(row["name"]) for row in rows}

        migration_sql: list[str] = []
        if "process_id" not in existing_columns:
            migration_sql.append("ALTER TABLE daemon_state ADD COLUMN process_id INTEGER")
        if "interval_seconds" not in existing_columns:
            migration_sql.append("ALTER TABLE daemon_state ADD COLUMN interval_seconds INTEGER")
        if "interval_basis" not in existing_columns:
            migration_sql.append("ALTER TABLE daemon_state ADD COLUMN interval_basis TEXT")

        for statement in migration_sql:
            await conn.execute(statement)

    async def ensure_default_row(self) -> None:
        """Insert the single daemon_state row if it doesn't already exist."""
        await self._db.connection.execute(
            """
            INSERT INTO daemon_state (key, status, target_count, updated_at)
            VALUES (?, 'stopped', 0, ?)
            ON CONFLICT(key) DO NOTHING
            """,
            (_DAEMON_STATE_KEY, now()),
        )

    async def get_daemon_state(self) -> dict[str, Any]:
        """Return the persisted daemon lifecycle state."""
        async with self._db.connection.execute(
            "SELECT * FROM daemon_state WHERE key = ?",
            (_DAEMON_STATE_KEY,),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            raise KeyError("Daemon state not initialized")
        daemon_state = dict(row)
        raw_last_tick_summary = daemon_state["last_tick_summary"]
        if raw_last_tick_summary is not None:
            daemon_state["last_tick_summary"] = json.loads(raw_last_tick_summary)
        return daemon_state

    async def claim_daemon_start(
        self,
        *,
        config_path: str,
        profile_name: str | None,
        target_count: int,
        interval_seconds: int | None = None,
        interval_basis: str | None = None,
        expected_status: str = "stopped",
        expected_process_id: int | None = None,
        expected_updated_at: str | None = None,
    ) -> bool:
        """Atomically claim the daemon state for a new start attempt."""
        conn = self._db.connection
        validated_target_count = _validate_target_count(target_count)
        validated_interval_seconds = _validate_interval_seconds(interval_seconds)
        claimed_at = now()
        await conn.execute("BEGIN IMMEDIATE")
        try:
            async with conn.execute(
                """
                SELECT status, process_id
                     , updated_at
                FROM daemon_state
                WHERE key = ?
                """,
                (_DAEMON_STATE_KEY,),
            ) as cursor:
                row = await cursor.fetchone()

            if row is None:
                raise KeyError("Daemon state not initialized")

            if (
                row["status"] != expected_status
                or row["process_id"] != expected_process_id
                or (expected_updated_at is not None and row["updated_at"] != expected_updated_at)
            ):
                await conn.rollback()
                return False

            await conn.execute(
                """
                UPDATE daemon_state
                SET status = 'starting',
                    started_at = NULL,
                    last_heartbeat_at = NULL,
                    config_path = ?,
                    profile_name = ?,
                    process_id = NULL,
                    target_count = ?,
                    interval_seconds = ?,
                    interval_basis = ?,
                    updated_at = ?
                WHERE key = ?
                """,
                (
                    config_path,
                    profile_name,
                    validated_target_count,
                    validated_interval_seconds,
                    interval_basis,
                    claimed_at,
                    _DAEMON_STATE_KEY,
                ),
            )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        return True

    async def start_daemon(
        self,
        *,
        config_path: str,
        profile_name: str | None,
        target_count: int,
        process_id: int | None = None,
        interval_seconds: int | None = None,
        interval_basis: str | None = None,
        started_at: datetime | None = None,
    ) -> None:
        """Mark the daemon as running and persist its active configuration metadata."""
        validated_target_count = _validate_target_count(target_count)
        validated_process_id = _validate_process_id(process_id)
        validated_interval_seconds = _validate_interval_seconds(interval_seconds)
        started_at_iso = serialize_timestamp(started_at) or now()
        await self._db.execute(
            """
            UPDATE daemon_state
            SET status = 'running',
                started_at = ?,
                last_heartbeat_at = ?,
                config_path = ?,
                profile_name = ?,
                process_id = ?,
                target_count = ?,
                interval_seconds = ?,
                interval_basis = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (
                started_at_iso,
                started_at_iso,
                config_path,
                profile_name,
                validated_process_id,
                validated_target_count,
                validated_interval_seconds,
                interval_basis,
                started_at_iso,
                _DAEMON_STATE_KEY,
            ),
        )

    async def record_daemon_heartbeat(self, *, heartbeat_at: datetime | None = None) -> None:
        """Update the daemon heartbeat timestamp."""
        heartbeat_at_iso = serialize_timestamp(heartbeat_at) or now()
        await self._db.execute(
            """
            UPDATE daemon_state
            SET last_heartbeat_at = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (heartbeat_at_iso, heartbeat_at_iso, _DAEMON_STATE_KEY),
        )

    async def stop_daemon(self, *, stopped_at: datetime | None = None) -> None:
        """Mark the daemon as stopped while preserving the last active configuration."""
        stopped_at_iso = serialize_timestamp(stopped_at) or now()
        await self._db.execute(
            """
            UPDATE daemon_state
            SET status = 'stopped',
                process_id = NULL,
                updated_at = ?
            WHERE key = ?
            """,
            (stopped_at_iso, _DAEMON_STATE_KEY),
        )

    async def record_daemon_tick_result(
        self,
        *,
        status: str,
        run_count: int,
        summary: str,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error: str | None = None,
    ) -> None:
        """Persist a structured summary for the most recent scheduler tick."""
        completed_at_iso = serialize_timestamp(completed_at) or now()
        tick_summary = json.dumps(
            {
                "status": status,
                "run_count": run_count,
                "summary": summary,
                "started_at": serialize_timestamp(started_at),
                "completed_at": completed_at_iso,
                "error": error,
            }
        )
        await self._db.execute(
            """
            UPDATE daemon_state
            SET last_tick_summary = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (tick_summary, completed_at_iso, _DAEMON_STATE_KEY),
        )
