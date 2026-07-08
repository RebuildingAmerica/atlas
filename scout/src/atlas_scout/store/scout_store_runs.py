"""Run-oriented ScoutStore facade methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from datetime import datetime

    from atlas_shared import DiscoveryRunArtifacts

    from atlas_scout.store import ScoutStore


class ScoutStoreRunsMixin:
    """Delegate run operations to the runs repository."""

    async def create_run(
        self: ScoutStore,
        *,
        location: str,
        issues: list[str],
        search_depth: str,
    ) -> str:
        """Insert a new run record and return its ID."""
        return await self._runs.create_run(
            location=location, issues=issues, search_depth=search_depth
        )

    async def get_run(self: ScoutStore, run_id: str) -> dict[str, Any]:
        """Fetch a run by ID. Raises KeyError if not found."""
        return await self._runs.get_run(run_id)

    async def update_run_status(self: ScoutStore, run_id: str, status: str) -> None:
        """Update only the status field of a run."""
        await self._runs.update_run_status(run_id, status)

    async def complete_run(
        self: ScoutStore,
        run_id: str,
        *,
        queries: int,
        pages_fetched: int,
        entries_found: int,
        entries_after_dedup: int,
    ) -> None:
        """Mark a run as completed and record its final statistics."""
        await self._runs.complete_run(
            run_id,
            queries=queries,
            pages_fetched=pages_fetched,
            entries_found=entries_found,
            entries_after_dedup=entries_after_dedup,
        )

    async def fail_run(self: ScoutStore, run_id: str, error: str) -> None:
        """Mark a run as failed and record the error message."""
        await self._runs.fail_run(run_id, error)

    async def cancel_run(self: ScoutStore, run_id: str, error: str | None = None) -> None:
        """Mark a run as cancelled, optionally recording the cancellation reason."""
        await self._runs.cancel_run(run_id, error)

    async def list_runs(self: ScoutStore, limit: int = 50) -> list[dict[str, Any]]:
        """Return the most recent runs, newest first."""
        return await self._runs.list_runs(limit)

    async def list_syncable_run_ids(
        self: ScoutStore,
        *,
        limit: int | None = None,
        include_synced: bool = False,
    ) -> list[str]:
        """Return completed run IDs with stored artifacts ready for sync."""
        return await self._runs.list_syncable_run_ids(limit=limit, include_synced=include_synced)

    async def save_run_artifacts(
        self: ScoutStore,
        run_id: str,
        artifacts: DiscoveryRunArtifacts,
    ) -> str:
        """Persist a canonical artifact bundle for a run and return its stable hash."""
        return await self._runs.save_run_artifacts(run_id, artifacts)

    async def get_run_artifacts(
        self: ScoutStore,
        run_id: str,
    ) -> DiscoveryRunArtifacts | None:
        """Return the stored artifact bundle for a run, if present."""
        return await self._runs.get_run_artifacts(run_id)

    async def update_run_sync(
        self: ScoutStore,
        run_id: str,
        *,
        sync_status: str,
        remote_run_id: str | None = None,
        last_error: str | None = None,
        synced_at: datetime | None = None,
    ) -> DiscoveryRunArtifacts:
        """Update sync metadata inside the stored artifact bundle and return it."""
        return await self._runs.update_run_sync(
            run_id,
            sync_status=sync_status,
            remote_run_id=remote_run_id,
            last_error=last_error,
            synced_at=synced_at,
        )

    async def find_running_direct_run(self: ScoutStore, urls: list[str]) -> str | None:
        """Return a matching active direct-URL run ID when one is in progress."""
        return await self._runs.find_running_direct_run(urls)
