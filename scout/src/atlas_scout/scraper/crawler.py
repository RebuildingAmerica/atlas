"""Bounded link follower for crawling same-domain pages."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from atlas_discovery_engine.web_content import (
    _LinkExtractor as _LinkExtractor,
)
from atlas_discovery_engine.web_content import (
    extract_links as extract_links,
)

if TYPE_CHECKING:
    from atlas_shared import PageContent


class PageFetcher(Protocol):
    """Fetcher surface required by the link crawler."""

    async def fetch(self, url: str) -> PageContent | None:
        """Fetch a page or return None when it cannot be read."""


class LinkCrawler:
    """Crawls links discovered from a seed page up to a bounded depth and page count."""

    def __init__(
        self,
        fetcher: PageFetcher,
        max_depth: int = 2,
        max_pages: int = 20,
        same_domain: bool = True,
    ) -> None:
        """Configure the crawler with a fetcher instance and depth/page limits."""
        self._fetcher = fetcher
        self._max_depth = max_depth
        self._max_pages = max_pages
        self._same_domain = same_domain

    async def crawl(self, seed_url: str, seed_html: str) -> list[PageContent]:
        """Crawl links found in seed_html, fetching pages up to max_depth and max_pages."""
        visited: set[str] = {seed_url}
        results: list[PageContent] = []
        frontier: list[tuple[str, int]] = [
            (link, 1)
            for link in extract_links(seed_html, base_url=seed_url, same_domain=self._same_domain)
        ]

        while frontier and len(results) < self._max_pages:
            url, depth = frontier.pop(0)
            if url in visited or depth > self._max_depth:
                continue
            visited.add(url)

            page = await self._fetcher.fetch(url)
            if page is None:
                continue
            results.append(page)

        return results
