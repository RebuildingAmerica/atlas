"""Shared fetch outcome helpers for the Scout HTTP fetcher."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx
from atlas_shared import PageContent, SourceType

from atlas_scout.scraper.browser_fallback_heuristics import (
    BROWSER_FALLBACK_REASONS,
    BROWSER_FALLBACK_STATUS_CODES,
    looks_like_app_shell,
    looks_like_high_value_url,
)
from atlas_scout.scraper.fetch_outcome import (
    coerce_discovered_links,
    coerce_discovery_articles,
    parse_cached_datetime,
    parse_source_type,
)

if TYPE_CHECKING:
    from atlas_scout.scraper.extractor import ContentExtraction

logger = logging.getLogger(__name__)


class FetcherOutcomeMixin:
    """Outcome, cache, and browser fallback helpers for AsyncFetcher."""

    async def _get_cached_outcome(
        self,
        url: str,
        task_id: str,
    ) -> tuple[bool, dict[str, Any]]:
        """Return ``(cache_hit, outcome)`` for cached positive or negative fetch results."""
        if self._store is None or self._force_refresh:
            return False, {}

        ttl_days: int | None = self._cache_ttl if self._revisit_cached_urls else None
        cached = await self._store.get_cached_page(url, ttl_days=ttl_days)
        if cached is None:
            return False, {}

        metadata = cached["metadata"]
        discovered_links = coerce_discovered_links(metadata.get("discovered_links"))
        discovery_articles = coerce_discovery_articles(metadata.get("discovery_articles"))
        status = str(metadata.get("status") or "fetched")
        reason = metadata.get("reason")

        text = cached.get("text") or ""
        if status == "fetched" and text.strip():
            page = PageContent(
                url=url,
                text=text,
                title=str(metadata.get("title") or ""),
                task_id=task_id or None,
                discovered_links=discovered_links,
                publication=metadata.get("publication"),
                published_date=parse_cached_datetime(metadata.get("published_date")),
                source_type=parse_source_type(metadata.get("source_type")),
            )
            return True, self._make_outcome(
                url=url,
                task_id=task_id,
                page=page,
                status="fetched",
                error=None,
                discovered_links=discovered_links,
                discovery_articles=discovery_articles,
            )

        return True, self._make_outcome(
            url=url,
            task_id=task_id,
            page=None,
            status=status,
            error=str(reason) if reason else None,
            discovered_links=discovered_links,
            discovery_articles=discovery_articles,
        )

    async def _cache_positive_result(self, page: PageContent, *, render_mode: str) -> None:
        """Persist a successfully fetched page outcome."""
        if self._store is None:
            return
        await self._store.cache_page(
            page.url,
            page.text,
            {
                "status": "fetched",
                "reason": None,
                "title": page.title,
                "publication": page.publication,
                "published_date": page.published_date.isoformat() if page.published_date else None,
                "source_type": str(page.source_type),
                "discovered_links": page.discovered_links,
                "render_mode": render_mode,
            },
        )

    async def _cache_negative_result(
        self,
        url: str,
        *,
        reason: str,
        discovered_links: list[str],
        discovery_articles: list[dict[str, Any]] | None = None,
        browser_reason: str | None = None,
    ) -> None:
        """Persist a negative fetch outcome so future runs skip duplicate work by default."""
        if self._store is None:
            return
        await self._store.cache_page(
            url,
            "",
            {
                "status": "filtered",
                "reason": reason,
                "title": "",
                "publication": None,
                "published_date": None,
                "source_type": str(SourceType.WEBSITE),
                "discovered_links": discovered_links,
                "discovery_articles": discovery_articles or [],
                "render_mode": "html",
                "browser_reason": browser_reason,
            },
        )

    async def _maybe_render_with_browser(
        self,
        url: str,
        *,
        html: str,
        reason: str,
    ) -> ContentExtraction | None:
        """Render high-value failed pages with the bounded browser fallback."""
        if not self._should_try_browser_render(url=url, html=html, reason=reason):
            return None

        async with self._browser_budget_lock:
            if self._browser_render_attempts >= self._max_browser_renders_per_run:
                return None
            self._browser_render_attempts += 1

        async with self._browser_semaphore:
            from atlas_scout.scraper import fetcher as fetcher_module

            return await fetcher_module.render_url_with_browser(
                url, timeout_ms=self._browser_render_timeout_ms
            )

    def _should_try_browser_render(self, *, url: str, html: str, reason: str) -> bool:
        """Return whether a failed fetch/extract deserves browser CPU."""
        if not self._browser_fallback_enabled or self._max_browser_renders_per_run <= 0:
            return False
        if reason in BROWSER_FALLBACK_STATUS_CODES:
            return looks_like_high_value_url(url)
        if reason not in BROWSER_FALLBACK_REASONS:
            return False
        return looks_like_high_value_url(url) or looks_like_app_shell(html)

    @staticmethod
    def _make_outcome(
        *,
        url: str,
        task_id: str,
        page: PageContent | None,
        status: str,
        error: str | None,
        discovered_links: list[str],
        discovery_articles: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Build the normalized fetch outcome used by the pipeline."""
        return {
            "url": url,
            "task_id": task_id,
            "page": page,
            "status": status,
            "error": error,
            "discovered_links": discovered_links,
            "discovery_articles": discovery_articles or [],
        }

    @staticmethod
    def _error_reason(exc: Exception) -> str:
        """Return a stable reason code for a failed request."""
        if isinstance(exc, httpx.HTTPStatusError):
            return f"http_{exc.response.status_code}"
        if isinstance(exc, httpx.ConnectError):
            return "connect_error"
        if isinstance(exc, httpx.TimeoutException):
            return "timeout"
        return "request_error"
