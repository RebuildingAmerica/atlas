"""Local SQLite store for Atlas Scout runs, cache, entries, and daemon state.

ScoutStore is a thin facade over one repository per aggregate (see the
sibling *_repo.py modules), composed onto a single shared Database
connection. It exists so every existing caller can keep constructing and
calling a single ScoutStore exactly as before; narrowing individual
callers to depend on the Protocols in store/protocols.py instead of this
facade is deliberately left as separate, lower-risk follow-up work.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas_scout.sqlite_retry import run_sqlite_write
from atlas_scout.store.article_frontier_repo import ArticleFrontierRepository
from atlas_scout.store.articles_repo import ArticleRepository
from atlas_scout.store.daemon_repo import DaemonStateRepository
from atlas_scout.store.db import Database
from atlas_scout.store.entries_repo import EntryRepository
from atlas_scout.store.extraction_cache_repo import ExtractionCacheRepository
from atlas_scout.store.page_cache_repo import PageCacheRepository
from atlas_scout.store.page_tasks_repo import PageTasksRepository
from atlas_scout.store.runs_repo import RunsRepository
from atlas_scout.store.work_claims_repo import WorkClaimsRepository

if TYPE_CHECKING:
    from datetime import datetime

    from atlas_shared import DiscoveryRunArtifacts

__all__ = ["ScoutStore"]


class ScoutStore:
    """Async SQLite store for Scout's local state."""

    def __init__(self, db_path: str) -> None:
        """Store the database path; call initialize() before use."""
        self._db = Database(db_path)
        self._daemon = DaemonStateRepository(self._db)
        self._runs = RunsRepository(self._db)
        self._page_cache = PageCacheRepository(self._db)
        self._page_tasks = PageTasksRepository(self._db)
        self._extraction_cache = ExtractionCacheRepository(self._db)
        self._work_claims = WorkClaimsRepository(self._db, run_status_lookup=self._runs.run_status)
        self._entries = EntryRepository(self._db)
        self._articles = ArticleRepository(self._db)
        self._article_frontier = ArticleFrontierRepository(self._db)

    async def initialize(self, *, create_schema: bool = True) -> None:
        """Open the database connection and create tables if needed."""
        await self._db.connect()
        if not create_schema:
            return

        async def operation() -> None:
            conn = self._db.connection
            await conn.execute("PRAGMA journal_mode=WAL")
            await conn.execute("PRAGMA synchronous=NORMAL")
            await self._runs.ensure_schema()
            await self._page_cache.ensure_schema()
            await self._page_tasks.ensure_schema()
            await self._entries.ensure_schema()
            await self._articles.ensure_schema()
            await self._article_frontier.ensure_schema()
            await self._extraction_cache.ensure_schema()
            await self._work_claims.ensure_schema()
            await self._daemon.ensure_schema()
            await self._daemon.ensure_default_row()
            await conn.commit()

        await run_sqlite_write(operation, on_locked=self._db.rollback_quietly)

    async def close(self) -> None:
        """Close the database connection."""
        await self._db.close()

    async def list_tables(self) -> list[str]:
        """Return the names of all user tables in the database."""
        return await self._db.list_tables()

    # ------------------------------------------------------------------
    # Daemon state
    # ------------------------------------------------------------------

    async def get_daemon_state(self) -> dict[str, Any]:
        """Return the persisted daemon lifecycle state."""
        return await self._daemon.get_daemon_state()

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
        await self._daemon.start_daemon(
            config_path=config_path,
            profile_name=profile_name,
            target_count=target_count,
            process_id=process_id,
            interval_seconds=interval_seconds,
            interval_basis=interval_basis,
            started_at=started_at,
        )

    async def record_daemon_heartbeat(self, *, heartbeat_at: datetime | None = None) -> None:
        """Update the daemon heartbeat timestamp."""
        await self._daemon.record_daemon_heartbeat(heartbeat_at=heartbeat_at)

    async def stop_daemon(self, *, stopped_at: datetime | None = None) -> None:
        """Mark the daemon as stopped while preserving the last active configuration."""
        await self._daemon.stop_daemon(stopped_at=stopped_at)

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
        await self._daemon.record_daemon_tick_result(
            status=status,
            run_count=run_count,
            summary=summary,
            started_at=started_at,
            completed_at=completed_at,
            error=error,
        )

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    async def create_run(self, *, location: str, issues: list[str], search_depth: str) -> str:
        """Insert a new run record and return its ID."""
        return await self._runs.create_run(
            location=location, issues=issues, search_depth=search_depth
        )

    async def get_run(self, run_id: str) -> dict[str, Any]:
        """Fetch a run by ID. Raises KeyError if not found."""
        return await self._runs.get_run(run_id)

    async def update_run_status(self, run_id: str, status: str) -> None:
        """Update only the status field of a run."""
        await self._runs.update_run_status(run_id, status)

    async def complete_run(
        self,
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

    async def fail_run(self, run_id: str, error: str) -> None:
        """Mark a run as failed and record the error message."""
        await self._runs.fail_run(run_id, error)

    async def cancel_run(self, run_id: str, error: str | None = None) -> None:
        """Mark a run as cancelled, optionally recording the cancellation reason."""
        await self._runs.cancel_run(run_id, error)

    async def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return the most recent runs, newest first."""
        return await self._runs.list_runs(limit)

    async def list_syncable_run_ids(
        self,
        *,
        limit: int | None = None,
        include_synced: bool = False,
    ) -> list[str]:
        """Return completed run IDs with stored artifacts ready for sync."""
        return await self._runs.list_syncable_run_ids(limit=limit, include_synced=include_synced)

    async def save_run_artifacts(self, run_id: str, artifacts: DiscoveryRunArtifacts) -> str:
        """Persist a canonical artifact bundle for a run and return its stable hash."""
        return await self._runs.save_run_artifacts(run_id, artifacts)

    async def get_run_artifacts(self, run_id: str) -> DiscoveryRunArtifacts | None:
        """Return the stored artifact bundle for a run, if present."""
        return await self._runs.get_run_artifacts(run_id)

    async def update_run_sync(
        self,
        run_id: str,
        *,
        sync_status: str,
        remote_run_id: str | None = None,
        last_error: str | None = None,
        synced_at: datetime | None = None,
    ) -> DiscoveryRunArtifacts:
        """Update sync metadata inside the stored artifact bundle and return the updated bundle."""
        return await self._runs.update_run_sync(
            run_id,
            sync_status=sync_status,
            remote_run_id=remote_run_id,
            last_error=last_error,
            synced_at=synced_at,
        )

    async def find_running_direct_run(self, urls: list[str]) -> str | None:
        """Return a matching active direct-URL run ID when one is already in progress."""
        return await self._runs.find_running_direct_run(urls)

    # ------------------------------------------------------------------
    # Page cache
    # ------------------------------------------------------------------

    async def get_cached_page(self, url: str, ttl_days: int | None = 7) -> dict[str, Any] | None:
        """Return a cached page if it exists and is within TTL, else None."""
        return await self._page_cache.get_cached_page(url, ttl_days)

    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None:
        """Insert or replace a page in the cache."""
        await self._page_cache.cache_page(url, text, metadata)

    async def list_pages(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return cached pages ordered by most recent fetch time."""
        return await self._page_cache.list_pages(limit)

    # ------------------------------------------------------------------
    # Articles
    # ------------------------------------------------------------------

    async def bulk_save_articles(
        self,
        articles: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
        update_existing: bool = False,
    ) -> dict[str, int]:
        """Insert many article records, deduping existing URLs."""
        return await self._articles.bulk_save_articles(
            articles, batch_size=batch_size, update_existing=update_existing
        )

    async def existing_article_urls(self, urls: list[str] | None = None) -> set[str]:
        """Return article URLs already stored locally."""
        return await self._articles.existing_article_urls(urls)

    async def list_articles(
        self,
        *,
        limit: int = 100,
        provider: str | None = None,
        source_domain: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return stored articles ordered by publication time descending."""
        return await self._articles.list_articles(
            limit=limit, provider=provider, source_domain=source_domain
        )

    async def article_stats(self) -> dict[str, Any]:
        """Return article corpus counts and date coverage."""
        return await self._articles.article_stats()

    async def article_domain_counts(self) -> dict[str, int]:
        """Return article counts by source domain without scanning article metadata."""
        return await self._articles.article_domain_counts()

    async def article_semantic_duplicate_stats(self) -> dict[str, int]:
        """Return duplicate article counts for exact normalized title/date signatures."""
        return await self._articles.article_semantic_duplicate_stats()

    async def article_status_counts(self) -> dict[str, Any]:
        """Return fast article/frontier counts for live crawl status."""
        return await self._articles.article_status_counts()

    async def dedupe_articles_by_title_date(self, *, dry_run: bool) -> dict[str, int | bool]:
        """Delete duplicate article rows sharing the same normalized title and timestamp."""
        return await self._articles.dedupe_articles_by_title_date(dry_run=dry_run)

    # ------------------------------------------------------------------
    # Article frontier
    # ------------------------------------------------------------------

    async def upsert_article_frontier(
        self,
        items: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
    ) -> dict[str, int]:
        """Persist newly discovered article frontier URLs for resumable crawls."""
        return await self._article_frontier.upsert_article_frontier(items, batch_size=batch_size)

    async def claim_article_frontier_batch(
        self,
        *,
        limit: int,
        max_per_domain: int,
        blocked_domains: set[str],
        existing_article_urls: set[str],
        worker_id: str | None = None,
        lease_seconds: int = 900,
    ) -> list[dict[str, Any]]:
        """Lease pending article frontier URLs, balanced by domain."""
        return await self._article_frontier.claim_article_frontier_batch(
            limit=limit,
            max_per_domain=max_per_domain,
            blocked_domains=blocked_domains,
            existing_article_urls=existing_article_urls,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
        )

    async def list_article_frontier_pending(self, *, limit: int = 0) -> list[dict[str, Any]]:
        """Return pending article frontier rows ordered by current crawl priority."""
        return await self._article_frontier.list_article_frontier_pending(limit=limit)

    async def list_article_frontier_expansion_candidates(
        self,
        *,
        limit: int = 0,
        include_fetched: bool = False,
    ) -> list[dict[str, Any]]:
        """Return pending source, sitemap, feed, and robots rows for frontier expansion."""
        return await self._article_frontier.list_article_frontier_expansion_candidates(
            limit=limit, include_fetched=include_fetched
        )

    async def update_article_frontier_priorities(
        self,
        priorities: dict[str, int],
        *,
        batch_size: int = 5000,
    ) -> int:
        """Update pending article frontier priorities by URL."""
        return await self._article_frontier.update_article_frontier_priorities(
            priorities, batch_size=batch_size
        )

    async def mark_article_frontier_fetched(self, urls: list[str]) -> None:
        """Mark article frontier URLs as fetched."""
        await self._article_frontier.mark_article_frontier_fetched(urls)

    async def mark_article_frontier_skipped(self, urls: list[str]) -> None:
        """Mark article frontier URLs as skipped because they no longer need fetching."""
        await self._article_frontier.mark_article_frontier_skipped(urls)

    async def release_article_frontier_claims(self, urls: list[str], *, worker_id: str) -> int:
        """Release unfinished article frontier leases owned by one worker."""
        return await self._article_frontier.release_article_frontier_claims(
            urls, worker_id=worker_id
        )

    async def release_article_frontier_claims_by_worker(self, *, worker_id: str) -> int:
        """Release all unfinished article frontier leases owned by one worker."""
        return await self._article_frontier.release_article_frontier_claims_by_worker(
            worker_id=worker_id
        )

    async def article_frontier_stats(self) -> dict[str, Any]:
        """Return pending/fetched/skipped article frontier counts."""
        return await self._article_frontier.article_frontier_stats()

    # ------------------------------------------------------------------
    # Page tasks
    # ------------------------------------------------------------------

    async def create_page_task(self, run_id: str, url: str) -> str:
        """Create a page task in queued status and return its ID."""
        return await self._page_tasks.create_page_task(run_id, url)

    async def update_page_task(
        self,
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

    async def list_page_tasks(self, run_id: str) -> list[dict[str, Any]]:
        """Return page tasks for one run ordered by creation time."""
        return await self._page_tasks.list_page_tasks(run_id)

    async def list_all_page_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent page tasks across all runs."""
        return await self._page_tasks.list_all_page_tasks(limit)

    async def get_page_task_summary(self, run_id: str) -> dict[str, int]:
        """Return counts of page tasks by status for a run."""
        return await self._page_tasks.get_page_task_summary(run_id)

    # ------------------------------------------------------------------
    # Extraction cache
    # ------------------------------------------------------------------

    async def get_cached_extraction(self, cache_key: str) -> dict[str, Any] | None:
        """Return a cached extraction result if present."""
        return await self._extraction_cache.get_cached_extraction(cache_key)

    async def cache_extraction(
        self,
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

    # ------------------------------------------------------------------
    # Cross-run work claims
    # ------------------------------------------------------------------

    async def claim_work(
        self,
        key: str,
        *,
        owner_run_id: str,
        lease_seconds: int = 120,
    ) -> bool:
        """Attempt to claim a work unit. Returns True only for the winning claimant."""
        return await self._work_claims.claim_work(
            key, owner_run_id=owner_run_id, lease_seconds=lease_seconds
        )

    async def complete_work(self, key: str) -> None:
        """Mark a claimed work unit as completed."""
        await self._work_claims.complete_work(key)

    async def fail_work(self, key: str, error: str) -> None:
        """Mark a claimed work unit as failed."""
        await self._work_claims.fail_work(key, error)

    async def get_work_claim(self, key: str) -> dict[str, Any] | None:
        """Return the current state of a work claim, if one exists."""
        return await self._work_claims.get_work_claim(key)

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------

    async def save_entry(
        self,
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
        self,
        *,
        run_id: str,
        entries: list[dict[str, Any]],
        batch_size: int = 5000,
    ) -> list[str]:
        """Insert many entries efficiently and return their IDs."""
        return await self._entries.bulk_save_entries(
            run_id=run_id, entries=entries, batch_size=batch_size
        )

    async def existing_source_keys(self, entry_type: str | None = None) -> set[str]:
        """Return source identity keys already present in local entries."""
        return await self._entries.existing_source_keys(entry_type)

    async def count_entries_by_source_dataset(self, source_dataset: str) -> int:
        """Return the number of active entries tagged with one source dataset."""
        return await self._entries.count_entries_by_source_dataset(source_dataset)

    async def purge_entries_by_source_dataset(self, source_dataset: str) -> int:
        """Delete active entries tagged with one source dataset."""
        return await self._entries.purge_entries_by_source_dataset(source_dataset)

    async def entry_stats(
        self,
        *,
        run_id: str | None = None,
        excluded_source_datasets: set[str] | None = None,
    ) -> dict[str, Any]:
        """Return aggregate entry counts for launch-data quality checks."""
        return await self._entries.entry_stats(
            run_id=run_id, excluded_source_datasets=excluded_source_datasets
        )

    async def list_entries(
        self,
        run_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Return entries, optionally filtered by run and minimum score."""
        return await self._entries.list_entries(run_id, min_score)
