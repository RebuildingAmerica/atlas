"""Async HTTP fetcher with shared clients, work claims, and tracked outcomes."""

from __future__ import annotations

import asyncio
import importlib.util
import logging
from typing import Any, Protocol

import httpx
from atlas_shared import PageContent

from atlas_scout.articles.discovery_records import discovery_articles_from_resource
from atlas_scout.scraper.browser_fallback_heuristics import looks_like_sparse_civic_roster
from atlas_scout.scraper.browser_render import render_url_with_browser as _render_url_with_browser
from atlas_scout.scraper.discovery_resources import extract_discovery_links
from atlas_scout.scraper.extractor import (
    extract_content_verbose,
    extract_structured_content,
)
from atlas_scout.scraper.fetcher_helpers import FetcherOutcomeMixin
from atlas_scout.scraper.pdf_extraction import extract_pdf_content

logger = logging.getLogger(__name__)

USER_AGENT = "AtlasScout/1.0 (+https://atlas.rebuildingus.org/scout)"
_CLAIM_POLL_SECONDS = 0.25


class FetcherStore(Protocol):
    """Narrow store interface AsyncFetcher needs: page cache plus work claims."""

    async def get_cached_page(
        self, url: str, ttl_days: int | None = 7
    ) -> dict[str, Any] | None: ...
    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None: ...
    async def claim_work(
        self, key: str, *, owner_run_id: str, lease_seconds: int = 120
    ) -> bool: ...
    async def complete_work(self, key: str) -> None: ...
    async def fail_work(self, key: str, error: str) -> None: ...
    async def get_work_claim(self, key: str) -> dict[str, Any] | None: ...


async def render_url_with_browser(url: str, *, timeout_ms: int) -> Any:
    """Expose the browser renderer for monkeypatching by tests and callers."""
    return await _render_url_with_browser(url, timeout_ms=timeout_ms)


class AsyncFetcher(FetcherOutcomeMixin):
    """Async HTTP fetcher with concurrency limiting, shared cache, and detailed outcomes."""

    def __init__(
        self,
        max_concurrent: int = 20,
        request_delay_ms: int = 200,
        timeout: float = 30.0,
        page_cache_ttl_days: int = 7,
        store: FetcherStore | None = None,
        revisit_cached_urls: bool = False,
        force_refresh: bool = False,
        run_id: str | None = None,
        browser_fallback_enabled: bool = False,
        browser_render_timeout_ms: int = 15000,
        max_browser_renders_per_run: int = 8,
        max_browser_concurrent: int = 1,
    ) -> None:
        """Configure concurrency, delays, and cache refresh policy."""
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._delay = request_delay_ms / 1000.0
        self._timeout = timeout
        self._cache_ttl = page_cache_ttl_days
        self._store = store
        self._revisit_cached_urls = revisit_cached_urls
        self._force_refresh = force_refresh
        self._run_id = run_id or "anonymous"
        self._browser_fallback_enabled = browser_fallback_enabled
        self._browser_render_timeout_ms = browser_render_timeout_ms
        self._max_browser_renders_per_run = max_browser_renders_per_run
        self._browser_render_attempts = 0
        self._browser_budget_lock = asyncio.Lock()
        self._browser_semaphore = asyncio.Semaphore(max_browser_concurrent)
        self._client = httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
            http2=importlib.util.find_spec("h2") is not None,
        )

    def bind_run(self, run_id: str) -> None:
        """Attach the current pipeline run ID for shared fetch claims."""
        self._run_id = run_id

    @property
    def max_concurrent(self) -> int:
        """Return the configured fetch concurrency."""
        return self._max_concurrent

    async def close(self) -> None:
        """Close the shared HTTP client."""
        await self._client.aclose()

    async def fetch(self, url: str) -> PageContent | None:
        """Fetch a URL and return extracted page content when available."""
        outcome = await self.fetch_tracked_verbose(url, task_id="", _store=self._store)
        page = outcome["page"]
        return page if isinstance(page, PageContent) else None

    async def fetch_tracked(
        self,
        url: str,
        task_id: str,
        _store: FetcherStore | None,
    ) -> PageContent | None:
        """Fetch a URL and stamp the current page-task ID on the result."""
        outcome = await self.fetch_tracked_verbose(url, task_id=task_id, _store=_store)
        page = outcome["page"]
        return page if isinstance(page, PageContent) else None

    async def fetch_tracked_verbose(
        self,
        url: str,
        task_id: str,
        _store: FetcherStore | None,
    ) -> dict[str, Any]:
        """Fetch a URL and return a structured outcome for pipeline progress/reporting."""
        cache_hit, cached = await self._get_cached_outcome(url, task_id)
        if cache_hit:
            return cached

        if self._store is None:
            return await self._fetch_network(url, task_id)

        claim_key = f"fetch:{url}"
        deadline = asyncio.get_running_loop().time() + max(self._timeout, 30.0)

        while True:
            if await self._store.claim_work(claim_key, owner_run_id=self._run_id):
                try:
                    outcome = await self._fetch_network(url, task_id)
                except Exception as exc:
                    await self._store.fail_work(claim_key, str(exc))
                    raise
                await self._store.complete_work(claim_key)
                return outcome

            cache_hit, cached = await self._get_cached_outcome(url, task_id)
            if cache_hit:
                return cached

            claim = await self._store.get_work_claim(claim_key)
            if claim is None or claim.get("status") != "inflight":
                continue
            if asyncio.get_running_loop().time() >= deadline:
                logger.debug("Timed out waiting on shared fetch claim for %s", url)
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error="shared_fetch_timeout",
                    discovered_links=[],
                )
            await asyncio.sleep(_CLAIM_POLL_SECONDS)

    async def fetch_many(self, urls: list[str]) -> list[PageContent]:
        """Fetch many URLs concurrently and return successful page results."""
        tasks = [self.fetch(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [result for result in results if isinstance(result, PageContent)]

    async def _fetch_network(self, url: str, task_id: str) -> dict[str, Any]:
        """Fetch one URL from the network and persist a reusable outcome."""
        async with self._semaphore:
            if self._delay > 0:
                await asyncio.sleep(self._delay)
            try:
                response = await self._client.get(url)
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                reason = self._error_reason(exc)
                rendered = await self._maybe_render_with_browser(
                    url,
                    html="",
                    reason=reason,
                )
                if rendered is not None and rendered.page is not None:
                    page = rendered.page.model_copy(
                        update={"task_id": task_id or rendered.page.task_id}
                    )
                    await self._cache_positive_result(page, render_mode="browser")
                    return self._make_outcome(
                        url=url,
                        task_id=task_id,
                        page=page,
                        status="fetched",
                        error=None,
                        discovered_links=rendered.discovered_links,
                    )
                logger.debug("Failed to fetch %s: %s", url, exc)
                await self._cache_negative_result(
                    url,
                    reason=reason,
                    discovered_links=(rendered.discovered_links if rendered is not None else []),
                    browser_reason=rendered.reason if rendered is not None else None,
                )
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error=reason,
                    discovered_links=rendered.discovered_links if rendered is not None else [],
                )
            except httpx.RequestError as exc:
                reason = self._error_reason(exc)
                logger.debug("Failed to fetch %s: %s", url, exc)
                await self._cache_negative_result(url, reason=reason, discovered_links=[])
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error=reason,
                    discovered_links=[],
                )

            content_type = response.headers.get("content-type", "")
            discovery_links = extract_discovery_links(
                response.content,
                url=url,
                content_type=content_type,
            )
            discovery_articles = discovery_articles_from_resource(
                response.content,
                url=url,
                content_type=content_type,
            )
            if discovery_links:
                await self._cache_negative_result(
                    url,
                    reason="discovery_resource",
                    discovered_links=discovery_links,
                    discovery_articles=discovery_articles,
                )
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error="discovery_resource",
                    discovered_links=discovery_links,
                    discovery_articles=discovery_articles,
                )
            structured = extract_structured_content(
                response.content,
                url=url,
                content_type=content_type,
            )
            if structured is not None:
                extracted = structured
            elif "application/pdf" in content_type:
                extracted = extract_pdf_content(response.content, url=url)
            else:
                extracted = extract_content_verbose(response.text, url=url)
            if extracted.page is None:
                reason = extracted.reason or "content_not_extractable"
                rendered = await self._maybe_render_with_browser(
                    url,
                    html=response.text,
                    reason=reason,
                )
                if rendered is not None and rendered.page is not None:
                    page = rendered.page.model_copy(
                        update={"task_id": task_id or rendered.page.task_id}
                    )
                    await self._cache_positive_result(page, render_mode="browser")
                    return self._make_outcome(
                        url=url,
                        task_id=task_id,
                        page=page,
                        status="fetched",
                        error=None,
                        discovered_links=rendered.discovered_links,
                    )

                discovered_links = extracted.discovered_links
                browser_reason = None
                if rendered is not None:
                    discovered_links = rendered.discovered_links or extracted.discovered_links
                    browser_reason = rendered.reason
                await self._cache_negative_result(
                    url,
                    reason=reason,
                    discovered_links=discovered_links,
                    browser_reason=browser_reason,
                )
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error=reason,
                    discovered_links=discovered_links,
                )

            page = extracted.page.model_copy(
                update={
                    "task_id": task_id or extracted.page.task_id,
                    "discovered_links": extracted.discovered_links,
                }
            )
            if looks_like_sparse_civic_roster(page.text):
                rendered = await self._maybe_render_with_browser(
                    url,
                    html=response.text,
                    reason="sparse_civic_roster",
                )
                if rendered is not None and rendered.page is not None:
                    page = rendered.page.model_copy(
                        update={"task_id": task_id or rendered.page.task_id}
                    )
                    await self._cache_positive_result(page, render_mode="browser")
                    return self._make_outcome(
                        url=url,
                        task_id=task_id,
                        page=page,
                        status="fetched",
                        error=None,
                        discovered_links=rendered.discovered_links,
                    )
            await self._cache_positive_result(page, render_mode="html")
            return self._make_outcome(
                url=url,
                task_id=task_id,
                page=page,
                status="fetched",
                error=None,
                discovered_links=extracted.discovered_links,
            )
