"""Async HTTP fetcher with rate limiting and optional page cache."""

from __future__ import annotations

import asyncio
import logging

import httpx

from atlas_shared import PageContent
from atlas_scout.scraper.extractor import extract_content

logger = logging.getLogger(__name__)

USER_AGENT = "AtlasScout/1.0 (+https://atlas.rebuilding.us/scout)"


class AsyncFetcher:
    """Async HTTP fetcher with concurrency limiting, delay, and optional page cache."""

    def __init__(
        self,
        max_concurrent: int = 20,
        request_delay_ms: int = 200,
        timeout: float = 30.0,
        page_cache_ttl_days: int = 7,
        store: object | None = None,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._delay = request_delay_ms / 1000.0
        self._timeout = timeout
        self._cache_ttl = page_cache_ttl_days
        self._store = store  # Optional ScoutStore for page cache

    async def fetch(self, url: str) -> PageContent | None:
        """Fetch a URL and return extracted PageContent, or None on failure."""
        # Check cache first (if store provided)
        if self._store is not None:
            cached = await self._store.get_cached_page(url, ttl_days=self._cache_ttl)  # type: ignore[union-attr]
            if cached:
                return PageContent(
                    url=url,
                    text=cached["text"],
                    title=cached["metadata"].get("title") or "",
                    published_date=cached["metadata"].get("published_date"),
                )

        async with self._semaphore:
            if self._delay > 0:
                await asyncio.sleep(self._delay)
            try:
                async with httpx.AsyncClient(
                    timeout=self._timeout,
                    follow_redirects=True,
                    headers={"User-Agent": USER_AGENT},
                ) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                logger.debug("Failed to fetch %s: %s", url, exc)
                return None

            page = extract_content(resp.text, url=url)
            if page is None:
                return None

            # Cache result
            if self._store is not None:
                await self._store.cache_page(  # type: ignore[union-attr]
                    url,
                    page.text,
                    {"title": page.title, "published_date": page.published_date},
                )
            return page

    async def fetch_many(self, urls: list[str]) -> list[PageContent]:
        """Fetch multiple URLs concurrently and return all successful results."""
        tasks = [self.fetch(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r for r in results if isinstance(r, PageContent)]
