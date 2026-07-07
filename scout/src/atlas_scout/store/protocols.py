"""Narrow Protocols over each store repository.

Not yet adopted by any caller — callers still depend on the concrete
ScoutStore facade (see store/__init__.py). These exist so that a future,
independent pass can narrow each caller's type annotation to only the
repository it actually uses (e.g. scraper/fetcher.py only ever needs
PageCacheStore + WorkClaimStore, not the full ScoutStore), without
requiring another physical code split at that time.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from datetime import datetime

    from atlas_shared import DiscoveryRunArtifacts


class DaemonStateStore(Protocol):
    """Narrow interface over daemon lifecycle state."""

    async def get_daemon_state(self) -> dict[str, Any]: ...
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
    ) -> bool: ...
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
    ) -> None: ...
    async def record_daemon_heartbeat(self, *, heartbeat_at: datetime | None = None) -> None: ...
    async def stop_daemon(self, *, stopped_at: datetime | None = None) -> None: ...
    async def record_daemon_tick_result(
        self,
        *,
        status: str,
        run_count: int,
        summary: str,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error: str | None = None,
    ) -> None: ...


class RunStore(Protocol):
    """Narrow interface over discovery-run lifecycle and synced artifacts."""

    async def create_run(self, *, location: str, issues: list[str], search_depth: str) -> str: ...
    async def get_run(self, run_id: str) -> dict[str, Any]: ...
    async def update_run_status(self, run_id: str, status: str) -> None: ...
    async def complete_run(
        self,
        run_id: str,
        *,
        queries: int,
        pages_fetched: int,
        entries_found: int,
        entries_after_dedup: int,
    ) -> None: ...
    async def fail_run(self, run_id: str, error: str) -> None: ...
    async def cancel_run(self, run_id: str, error: str | None = None) -> None: ...
    async def list_runs(self, limit: int = 50) -> list[dict[str, Any]]: ...
    async def list_syncable_run_ids(
        self, *, limit: int | None = None, include_synced: bool = False
    ) -> list[str]: ...
    async def save_run_artifacts(self, run_id: str, artifacts: DiscoveryRunArtifacts) -> str: ...
    async def get_run_artifacts(self, run_id: str) -> DiscoveryRunArtifacts | None: ...
    async def update_run_sync(
        self,
        run_id: str,
        *,
        sync_status: str,
        remote_run_id: str | None = None,
        last_error: str | None = None,
        synced_at: datetime | None = None,
    ) -> DiscoveryRunArtifacts: ...
    async def find_running_direct_run(self, urls: list[str]) -> str | None: ...
    async def run_status(self, run_id: str) -> str | None: ...


class PageCacheStore(Protocol):
    """Narrow interface over the fetched-page cache."""

    async def get_cached_page(
        self, url: str, ttl_days: int | None = 7
    ) -> dict[str, Any] | None: ...
    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None: ...
    async def list_pages(self, limit: int = 100) -> list[dict[str, Any]]: ...


class PageTaskStore(Protocol):
    """Narrow interface over per-URL page task tracking."""

    async def create_page_task(self, run_id: str, url: str) -> str: ...
    async def update_page_task(
        self,
        task_id: str,
        status: str,
        *,
        error: str | None = None,
        entries_extracted: int | None = None,
    ) -> None: ...
    async def list_page_tasks(self, run_id: str) -> list[dict[str, Any]]: ...
    async def list_all_page_tasks(self, limit: int = 100) -> list[dict[str, Any]]: ...
    async def get_page_task_summary(self, run_id: str) -> dict[str, int]: ...


class ExtractionCacheStore(Protocol):
    """Narrow interface over the LLM extraction result cache."""

    async def get_cached_extraction(self, cache_key: str) -> dict[str, Any] | None: ...
    async def cache_extraction(
        self,
        *,
        cache_key: str,
        source_fingerprint: str,
        provider_key: str,
        prompt_key: str,
        entries: list[dict[str, Any]],
    ) -> None: ...


class WorkClaimStore(Protocol):
    """Narrow interface over cross-run work-unit leasing."""

    async def claim_work(
        self, key: str, *, owner_run_id: str, lease_seconds: int = 120
    ) -> bool: ...
    async def complete_work(self, key: str) -> None: ...
    async def fail_work(self, key: str, error: str) -> None: ...
    async def get_work_claim(self, key: str) -> dict[str, Any] | None: ...


class EntryWriter(Protocol):
    """Narrow interface for writing/reading discovered entries."""

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
    ) -> str: ...
    async def bulk_save_entries(
        self, *, run_id: str, entries: list[dict[str, Any]], batch_size: int = 5000
    ) -> list[str]: ...
    async def existing_source_keys(self, entry_type: str | None = None) -> set[str]: ...
    async def count_entries_by_source_dataset(self, source_dataset: str) -> int: ...
    async def purge_entries_by_source_dataset(self, source_dataset: str) -> int: ...
    async def entry_stats(
        self, *, run_id: str | None = None, excluded_source_datasets: set[str] | None = None
    ) -> dict[str, Any]: ...
    async def list_entries(
        self, run_id: str | None = None, min_score: float = 0.0
    ) -> list[dict[str, Any]]: ...


class ArticleStore(Protocol):
    """Narrow interface over imported news articles."""

    async def bulk_save_articles(
        self,
        articles: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
        update_existing: bool = False,
    ) -> dict[str, int]: ...
    async def existing_article_urls(self, urls: list[str] | None = None) -> set[str]: ...
    async def list_articles(
        self, *, limit: int = 100, provider: str | None = None, source_domain: str | None = None
    ) -> list[dict[str, Any]]: ...
    async def article_stats(self) -> dict[str, Any]: ...
    async def article_domain_counts(self) -> dict[str, int]: ...
    async def article_semantic_duplicate_stats(self) -> dict[str, int]: ...
    async def article_status_counts(self) -> dict[str, Any]: ...
    async def dedupe_articles_by_title_date(self, *, dry_run: bool) -> dict[str, int | bool]: ...


class ArticleFrontierStore(Protocol):
    """Narrow interface over the durable, domain-balanced article crawl frontier."""

    async def upsert_article_frontier(
        self, items: list[dict[str, Any]], *, batch_size: int = 5000
    ) -> dict[str, int]: ...
    async def claim_article_frontier_batch(
        self,
        *,
        limit: int,
        max_per_domain: int,
        blocked_domains: set[str],
        existing_article_urls: set[str],
        worker_id: str | None = None,
        lease_seconds: int = 900,
    ) -> list[dict[str, Any]]: ...
    async def list_article_frontier_pending(self, *, limit: int = 0) -> list[dict[str, Any]]: ...
    async def list_article_frontier_expansion_candidates(
        self, *, limit: int = 0, include_fetched: bool = False
    ) -> list[dict[str, Any]]: ...
    async def update_article_frontier_priorities(
        self, priorities: dict[str, int], *, batch_size: int = 5000
    ) -> int: ...
    async def mark_article_frontier_fetched(self, urls: list[str]) -> None: ...
    async def mark_article_frontier_skipped(self, urls: list[str]) -> None: ...
    async def release_article_frontier_claims(self, urls: list[str], *, worker_id: str) -> int: ...
    async def release_article_frontier_claims_by_worker(self, *, worker_id: str) -> int: ...
    async def article_frontier_stats(self) -> dict[str, Any]: ...
