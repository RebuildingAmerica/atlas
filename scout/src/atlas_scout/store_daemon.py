"""Daemon-state mixin for Atlas Scout."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from datetime import datetime

from atlas_scout.store_core import (
    _DAEMON_STATE_KEY,
    _now,
    _serialize_timestamp,
    _validate_interval_seconds,
    _validate_process_id,
    _validate_target_count,
)


class ScoutStoreDaemonMixin:
    async def get_daemon_state(self) -> dict[str, Any]:
        """Return the persisted daemon lifecycle state."""
        assert self._conn is not None
        async with self._conn.execute(
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
        assert self._conn is not None
        validated_target_count = _validate_target_count(target_count)
        validated_interval_seconds = _validate_interval_seconds(interval_seconds)
        claimed_at = _now()
        await self._conn.execute("BEGIN IMMEDIATE")
        try:
            async with self._conn.execute(
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
                await self._conn.rollback()
                return False

            await self._conn.execute(
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
            await self._conn.commit()
        except Exception:
            await self._conn.rollback()
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
        started_at_iso = _serialize_timestamp(started_at) or _now()
        await self._execute(
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
        heartbeat_at_iso = _serialize_timestamp(heartbeat_at) or _now()
        await self._execute(
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
        stopped_at_iso = _serialize_timestamp(stopped_at) or _now()
        await self._execute(
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
        completed_at_iso = _serialize_timestamp(completed_at) or _now()
        tick_summary = json.dumps(
            {
                "status": status,
                "run_count": run_count,
                "summary": summary,
                "started_at": _serialize_timestamp(started_at),
                "completed_at": completed_at_iso,
                "error": error,
            }
        )
        await self._execute(
            """
            UPDATE daemon_state
            SET last_tick_summary = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (tick_summary, completed_at_iso, _DAEMON_STATE_KEY),
        )

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------
