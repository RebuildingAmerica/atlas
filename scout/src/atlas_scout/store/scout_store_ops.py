"""Task, extraction-cache, work-claim, and entry ScoutStore methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore


class ScoutStoreOpsMixin:
    """Delegate operational and entry writes to their repositories."""

    async def create_page_task(self: ScoutStore, run_id: str, url: str) -> str:
        """Create a page task in queued status and return its ID."""
        return await self._page_tasks.create_page_task(run_id, url)

    async def update_page_task(
        self: ScoutStore,
        task_id: str,
        status: str,
        *,
        error: str | None = None,
        entries_extracted: int | None = None,
    ) -> None:
        """Update a page task status and optional result fields."""
        await self._page_tasks.update_page_task(
            task_id, status, error=error, entries_extracted=entries_extracted
        )

    async def list_page_tasks(self: ScoutStore, run_id: str) -> list[dict[str, Any]]:
        """Return page tasks for one run ordered by creation time."""
        return await self._page_tasks.list_page_tasks(run_id)

    async def list_all_page_tasks(self: ScoutStore, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent page tasks across all runs."""
        return await self._page_tasks.list_all_page_tasks(limit)

    async def get_page_task_summary(self: ScoutStore, run_id: str) -> dict[str, int]:
        """Return counts of page tasks by status for a run."""
        return await self._page_tasks.get_page_task_summary(run_id)

    async def get_cached_extraction(self: ScoutStore, cache_key: str) -> dict[str, Any] | None:
        """Return a cached extraction result if present."""
        return await self._extraction_cache.get_cached_extraction(cache_key)

    async def cache_extraction(
        self: ScoutStore,
        *,
        cache_key: str,
        source_fingerprint: str,
        provider_key: str,
        prompt_key: str,
        entries: list[dict[str, Any]],
    ) -> None:
        """Insert or replace a structured extraction result."""
        await self._extraction_cache.cache_extraction(
            cache_key=cache_key,
            source_fingerprint=source_fingerprint,
            provider_key=provider_key,
            prompt_key=prompt_key,
            entries=entries,
        )

    async def claim_work(
        self: ScoutStore,
        key: str,
        *,
        owner_run_id: str,
        lease_seconds: int = 120,
    ) -> bool:
        """Attempt to claim a work unit. Returns True only for the winner."""
        return await self._work_claims.claim_work(
            key, owner_run_id=owner_run_id, lease_seconds=lease_seconds
        )

    async def complete_work(self: ScoutStore, key: str) -> None:
        """Mark a claimed work unit as completed."""
        await self._work_claims.complete_work(key)

    async def fail_work(self: ScoutStore, key: str, error: str) -> None:
        """Mark a claimed work unit as failed."""
        await self._work_claims.fail_work(key, error)

    async def get_work_claim(self: ScoutStore, key: str) -> dict[str, Any] | None:
        """Return the current state of a work claim, if one exists."""
        return await self._work_claims.get_work_claim(key)

    async def save_entry(
        self: ScoutStore,
        *,
        run_id: str,
        name: str,
        entry_type: str,
        description: str,
        city: str | None,
        state: str | None,
        score: float,
        data: dict[str, Any],
    ) -> str:
        """Insert an entry and return its ID."""
        return await self._entries.save_entry(
            run_id=run_id,
            name=name,
            entry_type=entry_type,
            description=description,
            city=city,
            state=state,
            score=score,
            data=data,
        )

    async def bulk_save_entries(
        self: ScoutStore,
        *,
        run_id: str,
        entries: list[dict[str, Any]],
        batch_size: int = 5000,
    ) -> list[str]:
        """Insert many entries efficiently and return their IDs."""
        return await self._entries.bulk_save_entries(
            run_id=run_id, entries=entries, batch_size=batch_size
        )

    async def existing_source_keys(self: ScoutStore, entry_type: str | None = None) -> set[str]:
        """Return source identity keys already present in local entries."""
        return await self._entries.existing_source_keys(entry_type)

    async def count_entries_by_source_dataset(self: ScoutStore, source_dataset: str) -> int:
        """Return the number of active entries tagged with one source dataset."""
        return await self._entries.count_entries_by_source_dataset(source_dataset)

    async def purge_entries_by_source_dataset(self: ScoutStore, source_dataset: str) -> int:
        """Delete active entries tagged with one source dataset."""
        return await self._entries.purge_entries_by_source_dataset(source_dataset)

    async def entry_stats(
        self: ScoutStore,
        *,
        run_id: str | None = None,
        excluded_source_datasets: set[str] | None = None,
    ) -> dict[str, Any]:
        """Return aggregate entry counts for launch-data quality checks."""
        return await self._entries.entry_stats(
            run_id=run_id, excluded_source_datasets=excluded_source_datasets
        )

    async def list_entries(
        self: ScoutStore,
        run_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Return entries, optionally filtered by run and minimum score."""
        return await self._entries.list_entries(run_id, min_score)
