"""Tests for atlas_scout.scraper.crawler."""

from __future__ import annotations

from atlas_shared import PageContent, SourceType

from atlas_scout.scraper.crawler import LinkCrawler, _LinkExtractor, extract_links


def test_extract_links_from_html() -> None:
    html = (
        "<html><body>"
        '<a href="https://example.com/page1">P1</a>'
        '<a href="https://example.com/page2">P2</a>'
        '<a href="/relative">Rel</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com/start")
    assert "https://example.com/page1" in links
    assert "https://example.com/page2" in links
    assert "https://example.com/relative" in links


def test_extract_links_filters_non_http() -> None:
    html = (
        "<html><body>"
        '<a href="mailto:test@x.com">E</a>'
        '<a href="javascript:void(0)">J</a>'
        '<a href="https://example.com/real">R</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com")
    assert len(links) == 1


def test_extract_links_same_domain_only() -> None:
    html = (
        "<html><body>"
        '<a href="https://example.com/internal">I</a>'
        '<a href="https://other.com/external">E</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com", same_domain=True)
    assert "https://example.com/internal" in links
    assert "https://other.com/external" not in links


def test_extract_links_allows_cross_domain_when_same_domain_false() -> None:
    html = (
        "<html><body>"
        '<a href="https://example.com/internal">I</a>'
        '<a href="https://other.com/external">E</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com", same_domain=False)
    assert "https://example.com/internal" in links
    assert "https://other.com/external" in links


def test_extract_links_dedupes_repeats_and_strips_fragments() -> None:
    html = (
        "<html><body>"
        '<a href="https://example.com/page#a">A</a>'
        '<a href="https://example.com/page#b">B</a>'
        '<a href="https://example.com/page/">C</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com")
    # All three normalize to the same URL
    assert links == ["https://example.com/page"]


def test_extract_links_ignores_non_anchor_tags_and_empty_href() -> None:
    html = (
        "<html><body>"
        "<div>not an anchor</div>"
        '<a>no href</a>'
        '<a href="">empty href</a>'
        '<a href="https://example.com/ok">OK</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com")
    assert links == ["https://example.com/ok"]


def test_link_extractor_skips_attrs_for_non_anchor_tags() -> None:
    parser = _LinkExtractor()
    parser.handle_starttag("div", [("href", "https://example.com/skipped")])
    assert parser.links == []


def test_extract_links_empty_html_returns_empty_list() -> None:
    assert extract_links("", base_url="https://example.com") == []


class _FakeFetcher:
    def __init__(self, pages: dict[str, PageContent | None]) -> None:
        self._pages = pages
        self.calls: list[str] = []

    async def fetch(self, url: str) -> PageContent | None:
        self.calls.append(url)
        return self._pages.get(url)


def _page(url: str) -> PageContent:
    return PageContent(url=url, text="x", title="t", source_type=SourceType.WEBSITE)


async def test_link_crawler_returns_fetched_pages_within_limits() -> None:
    seed = "https://example.com/"
    seed_html = (
        "<html><body>"
        '<a href="https://example.com/a">A</a>'
        '<a href="https://example.com/b">B</a>'
        "</body></html>"
    )
    fetcher = _FakeFetcher(
        {
            "https://example.com/a": _page("https://example.com/a"),
            "https://example.com/b": _page("https://example.com/b"),
        }
    )
    crawler = LinkCrawler(fetcher, max_depth=2, max_pages=10)
    results = await crawler.crawl(seed, seed_html)
    assert {p.url for p in results} == {"https://example.com/a", "https://example.com/b"}


async def test_link_crawler_skips_visited_and_caps_pages() -> None:
    seed = "https://example.com/"
    # Two links but we cap to 1 page.
    seed_html = (
        "<html><body>"
        '<a href="https://example.com/a">A</a>'
        '<a href="https://example.com/b">B</a>'
        "</body></html>"
    )
    fetcher = _FakeFetcher(
        {
            "https://example.com/a": _page("https://example.com/a"),
            "https://example.com/b": _page("https://example.com/b"),
        }
    )
    crawler = LinkCrawler(fetcher, max_depth=2, max_pages=1)
    results = await crawler.crawl(seed, seed_html)
    assert len(results) == 1


async def test_link_crawler_drops_none_fetch_results() -> None:
    seed = "https://example.com/"
    seed_html = '<html><body><a href="https://example.com/missing">M</a></body></html>'
    fetcher = _FakeFetcher({"https://example.com/missing": None})
    crawler = LinkCrawler(fetcher, max_depth=2, max_pages=5)
    results = await crawler.crawl(seed, seed_html)
    assert results == []
    assert fetcher.calls == ["https://example.com/missing"]


async def test_link_crawler_skips_seed_in_visited() -> None:
    # Seed URL appears as a link too. The crawler must not refetch the seed.
    seed = "https://example.com/seed"
    seed_html = (
        "<html><body>"
        '<a href="https://example.com/seed">Seed</a>'
        '<a href="https://example.com/other">Other</a>'
        "</body></html>"
    )
    fetcher = _FakeFetcher({"https://example.com/other": _page("https://example.com/other")})
    crawler = LinkCrawler(fetcher, max_depth=2, max_pages=5)
    results = await crawler.crawl(seed, seed_html)
    assert [p.url for p in results] == ["https://example.com/other"]
    # The fetcher is only invoked for the non-seed link.
    assert fetcher.calls == ["https://example.com/other"]


async def test_link_crawler_respects_max_depth() -> None:
    seed = "https://example.com/"
    seed_html = '<html><body><a href="https://example.com/a">A</a></body></html>'
    fetcher = _FakeFetcher({"https://example.com/a": _page("https://example.com/a")})
    # max_depth=0 means no link is visited (every link starts at depth 1).
    crawler = LinkCrawler(fetcher, max_depth=0, max_pages=5)
    results = await crawler.crawl(seed, seed_html)
    assert results == []
    assert fetcher.calls == []
