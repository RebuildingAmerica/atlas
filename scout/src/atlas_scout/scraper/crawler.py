"""Bounded link follower for crawling same-domain pages."""

from __future__ import annotations

from html.parser import HTMLParser
from typing import TYPE_CHECKING
from urllib.parse import urljoin, urlparse

if TYPE_CHECKING:
    from atlas_shared import PageContent


class _LinkExtractor(HTMLParser):
    """Simple HTML parser that collects href values from anchor tags."""

    def __init__(self) -> None:
        """Initialize the parser with an empty link list."""
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Collect href values from anchor tags."""
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.links.append(value)


def extract_links(html: str, base_url: str, same_domain: bool = True) -> list[str]:
    """Extract absolute, deduplicated links from HTML.

    Filters to same-domain links by default and strips URL fragments.
    """
    parser = _LinkExtractor()
    parser.feed(html)

    base_domain = urlparse(base_url).netloc
    seen: set[str] = set()
    result: list[str] = []

    for raw in parser.links:
        absolute = urljoin(base_url, raw)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if same_domain and parsed.netloc != base_domain:
            continue
        normalized = parsed._replace(fragment="").geturl().rstrip("/")
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)

    return result


class LinkCrawler:
    """Crawls links discovered from a seed page up to a bounded depth and page count."""

    def __init__(
        self,
        fetcher: object,
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

            page = await self._fetcher.fetch(url)  # type: ignore[union-attr]
            if page is None:
                continue
            results.append(page)

        return results
