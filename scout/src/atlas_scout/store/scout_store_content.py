"""Page-cache, article, extraction, and frontier ScoutStore methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore


class ScoutStoreContentMixin:
    """Delegate content and frontier operations to their repositories."""

    async def get_cached_page(
        self: ScoutStore,
        url: str,
        ttl_days: int | None = 7,
    ) -> dict[str, Any] | None:
        """Return a cached page if it exists and is within TTL, else None."""
        return await self._page_cache.get_cached_page(url, ttl_days)

    async def cache_page(self: ScoutStore, url: str, text: str, metadata: dict[str, Any]) -> None:
        """Insert or replace a page in the cache."""
        await self._page_cache.cache_page(url, text, metadata)

    async def list_pages(self: ScoutStore, limit: int = 100) -> list[dict[str, Any]]:
        """Return cached pages ordered by most recent fetch time."""
        return await self._page_cache.list_pages(limit)

    async def bulk_save_articles(
        self: ScoutStore,
        articles: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
        update_existing: bool = False,
    ) -> dict[str, int]:
        """Insert many article records, deduping existing URLs."""
        return await self._articles.bulk_save_articles(
            articles, batch_size=batch_size, update_existing=update_existing
        )

    async def existing_article_urls(
        self: ScoutStore,
        urls: list[str] | None = None,
    ) -> set[str]:
        """Return article URLs already stored locally."""
        return await self._articles.existing_article_urls(urls)

    async def list_articles(
        self: ScoutStore,
        *,
        limit: int = 100,
        provider: str | None = None,
        source_domain: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return stored articles ordered by publication time descending."""
        return await self._articles.list_articles(
            limit=limit, provider=provider, source_domain=source_domain
        )

    async def article_stats(self: ScoutStore) -> dict[str, Any]:
        """Return article corpus counts and date coverage."""
        return await self._articles.article_stats()

    async def article_domain_counts(self: ScoutStore) -> dict[str, int]:
        """Return article counts by source domain without scanning metadata."""
        return await self._articles.article_domain_counts()

    async def article_semantic_duplicate_stats(self: ScoutStore) -> dict[str, int]:
        """Return duplicate article counts for exact normalized title/date signatures."""
        return await self._articles.article_semantic_duplicate_stats()

    async def article_status_counts(self: ScoutStore) -> dict[str, Any]:
        """Return fast article/frontier counts for live crawl status."""
        return await self._articles.article_status_counts()

    async def dedupe_articles_by_title_date(
        self: ScoutStore,
        *,
        dry_run: bool,
    ) -> dict[str, int | bool]:
        """Delete duplicate article rows sharing the same normalized title and timestamp."""
        return await self._articles.dedupe_articles_by_title_date(dry_run=dry_run)

    async def claim_article_extraction_batch(
        self: ScoutStore,
        *,
        owner_run_id: str,
        provider_key: str,
        prompt_key: str,
        limit: int,
        lease_seconds: int = 600,
        retry_failed: bool = False,
    ) -> list[dict[str, Any]]:
        """Lease stored article rows for entry extraction."""
        return await self._article_extractions.claim_article_extraction_batch(
            owner_run_id=owner_run_id,
            provider_key=provider_key,
            prompt_key=prompt_key,
            limit=limit,
            lease_seconds=lease_seconds,
            retry_failed=retry_failed,
        )

    async def complete_article_extraction(
        self: ScoutStore,
        *,
        article_url: str,
        provider_key: str,
        prompt_key: str,
        entries_extracted: int,
    ) -> None:
        """Mark a stored article as processed for a provider and prompt."""
        await self._article_extractions.complete_article_extraction(
            article_url=article_url,
            provider_key=provider_key,
            prompt_key=prompt_key,
            entries_extracted=entries_extracted,
        )

    async def fail_article_extraction(
        self: ScoutStore,
        *,
        article_url: str,
        provider_key: str,
        prompt_key: str,
        error: str,
    ) -> None:
        """Mark a stored article extraction attempt as failed."""
        await self._article_extractions.fail_article_extraction(
            article_url=article_url,
            provider_key=provider_key,
            prompt_key=prompt_key,
            error=error,
        )

    async def upsert_article_frontier(
        self: ScoutStore,
        items: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
    ) -> dict[str, int]:
        """Persist newly discovered article frontier URLs for resumable crawls."""
        return await self._article_frontier.upsert_article_frontier(items, batch_size=batch_size)

    async def claim_article_frontier_batch(
        self: ScoutStore,
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

    async def list_article_frontier_pending(
        self: ScoutStore,
        *,
        limit: int = 0,
    ) -> list[dict[str, Any]]:
        """Return pending article frontier rows ordered by crawl priority."""
        return await self._article_frontier.list_article_frontier_pending(limit=limit)

    async def list_article_frontier_expansion_candidates(
        self: ScoutStore,
        *,
        limit: int = 0,
        include_fetched: bool = False,
    ) -> list[dict[str, Any]]:
        """Return pending source, sitemap, feed, and robots rows for expansion."""
        return await self._article_frontier.list_article_frontier_expansion_candidates(
            limit=limit, include_fetched=include_fetched
        )

    async def update_article_frontier_priorities(
        self: ScoutStore,
        priorities: dict[str, int],
        *,
        batch_size: int = 5000,
    ) -> int:
        """Update pending article frontier priorities by URL."""
        return await self._article_frontier.update_article_frontier_priorities(
            priorities, batch_size=batch_size
        )

    async def mark_article_frontier_fetched(self: ScoutStore, urls: list[str]) -> None:
        """Mark article frontier URLs as fetched."""
        await self._article_frontier.mark_article_frontier_fetched(urls)

    async def mark_article_frontier_skipped(self: ScoutStore, urls: list[str]) -> None:
        """Mark article frontier URLs as skipped because they no longer need fetching."""
        await self._article_frontier.mark_article_frontier_skipped(urls)

    async def release_article_frontier_claims(
        self: ScoutStore,
        urls: list[str],
        *,
        worker_id: str,
    ) -> int:
        """Release unfinished article frontier leases owned by one worker."""
        return await self._article_frontier.release_article_frontier_claims(
            urls, worker_id=worker_id
        )

    async def release_article_frontier_claims_by_worker(
        self: ScoutStore,
        *,
        worker_id: str,
    ) -> int:
        """Release all unfinished article frontier leases owned by one worker."""
        return await self._article_frontier.release_article_frontier_claims_by_worker(
            worker_id=worker_id
        )

    async def article_frontier_stats(self: ScoutStore) -> dict[str, Any]:
        """Return pending/fetched/skipped article frontier counts."""
        return await self._article_frontier.article_frontier_stats()
