"""Daemon-state ScoutStore facade methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from datetime import datetime

    from atlas_scout.store import ScoutStore


class ScoutStoreDaemonMixin:
    """Delegate daemon-state operations to the daemon repository."""

    async def get_daemon_state(self: ScoutStore) -> dict[str, Any]:
        """Return the persisted daemon lifecycle state."""
        return await self._daemon.get_daemon_state()

    async def claim_daemon_start(
        self: ScoutStore,
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
        return await self._daemon.claim_daemon_start(
            config_path=config_path,
            profile_name=profile_name,
            target_count=target_count,
            interval_seconds=interval_seconds,
            interval_basis=interval_basis,
            expected_status=expected_status,
            expected_process_id=expected_process_id,
            expected_updated_at=expected_updated_at,
        )

    async def start_daemon(
        self: ScoutStore,
        *,
        config_path: str,
        profile_name: str | None,
        target_count: int,
        process_id: int | None = None,
        interval_seconds: int | None = None,
        interval_basis: str | None = None,
        started_at: datetime | None = None,
    ) -> None:
        """Mark the daemon as running and persist its active metadata."""
        await self._daemon.start_daemon(
            config_path=config_path,
            profile_name=profile_name,
            target_count=target_count,
            process_id=process_id,
            interval_seconds=interval_seconds,
            interval_basis=interval_basis,
            started_at=started_at,
        )

    async def record_daemon_heartbeat(
        self: ScoutStore,
        *,
        heartbeat_at: datetime | None = None,
    ) -> None:
        """Update the daemon heartbeat timestamp."""
        await self._daemon.record_daemon_heartbeat(heartbeat_at=heartbeat_at)

    async def stop_daemon(
        self: ScoutStore,
        *,
        stopped_at: datetime | None = None,
    ) -> None:
        """Mark the daemon as stopped while preserving the last active config."""
        await self._daemon.stop_daemon(stopped_at=stopped_at)

    async def record_daemon_tick_result(
        self: ScoutStore,
        *,
        status: str,
        run_count: int,
        summary: str,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error: str | None = None,
    ) -> None:
        """Persist a structured summary for the most recent scheduler tick."""
        await self._daemon.record_daemon_tick_result(
            status=status,
            run_count=run_count,
            summary=summary,
            started_at=started_at,
            completed_at=completed_at,
            error=error,
        )
