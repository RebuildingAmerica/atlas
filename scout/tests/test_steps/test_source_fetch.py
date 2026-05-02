"""Tests for Step 2: source_fetch."""

from __future__ import annotations

import pytest
import respx
from atlas_shared import PageContent
from httpx import Response

from atlas_scout.scraper.fetcher import AsyncFetcher
from atlas_scout.steps.query_gen import SearchQuery
from atlas_scout.steps.source_fetch import _search_brave, fetch_sources_stream

_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
_FAKE_API_KEY = "test-key-123"


def _make_brave_response(urls: list[str]) -> dict:
    """Build a minimal Brave Search API JSON payload."""
    return {
        "web": {
            "results": [
                {"url": url, "title": f"Page at {url}", "profile": {"name": "Test Site"}}
                for url in urls
            ]
        }
    }


@pytest.mark.asyncio
@respx.mock
async def test_search_brave_returns_urls() -> None:
    """_search_brave returns a list of result dicts with 'url' keys."""
    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=Response(200, json=_make_brave_response(["https://example.com/a"]))
    )

    results = await _search_brave(["affordable housing Austin TX"], _FAKE_API_KEY)

    assert len(results) == 1
    assert results[0]["url"] == "https://example.com/a"
    assert results[0]["title"] == "Page at https://example.com/a"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_sources_stream_deduplicates_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    """fetch_sources_stream deduplicates the same URL returned by multiple queries."""
    shared_url = "https://example.com/shared"

    # Both queries return the same URL
    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=Response(200, json=_make_brave_response([shared_url]))
    )

    fetched_urls: list[str] = []

    async def _mock_fetch(url: str) -> PageContent | None:
        fetched_urls.append(url)
        return PageContent(url=url, text="some content about housing", title="Test")

    fetcher = AsyncFetcher()
    monkeypatch.setattr(fetcher, "fetch", _mock_fetch)

    queries = [
        SearchQuery(query="housing Austin TX nonprofit", source_category="nonprofits", issue_area="housing_affordability"),
        SearchQuery(query="housing Austin TX organizer", source_category="individuals", issue_area="housing_affordability"),
    ]

    pages = [p async for p in fetch_sources_stream(queries, fetcher, _FAKE_API_KEY)]

    # URL should only be fetched once despite appearing in two query results
    assert fetched_urls.count(shared_url) == 1
    assert len(pages) == 1
    assert pages[0].url == shared_url


@pytest.mark.asyncio
@respx.mock
async def test_fetch_sources_stream_yields_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    """fetch_sources_stream yields PageContent for each unique URL found."""
    urls = ["https://example.com/page1", "https://example.com/page2"]

    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=Response(200, json=_make_brave_response(urls))
    )

    async def _mock_fetch(url: str) -> PageContent | None:
        return PageContent(url=url, text="relevant content here with enough words " * 10, title="Title")

    fetcher = AsyncFetcher()
    monkeypatch.setattr(fetcher, "fetch", _mock_fetch)

    queries = [SearchQuery(query="test query", source_category="nonprofits", issue_area="housing_affordability")]
    pages = [p async for p in fetch_sources_stream(queries, fetcher, _FAKE_API_KEY)]

    assert len(pages) == 2
    page_urls = {p.url for p in pages}
    assert page_urls == set(urls)


@pytest.mark.asyncio
@respx.mock
async def test_fetch_sources_stream_returns_when_no_unique_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the search yields no URLs, the stream returns immediately."""
    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=Response(200, json={"web": {"results": []}})
    )

    fetched: list[str] = []

    async def _mock_fetch(url: str) -> PageContent | None:
        fetched.append(url)
        return None

    fetcher = AsyncFetcher()
    monkeypatch.setattr(fetcher, "fetch", _mock_fetch)

    queries = [
        SearchQuery(query="empty", source_category="nonprofits", issue_area="housing_affordability"),
    ]

    pages = [p async for p in fetch_sources_stream(queries, fetcher, _FAKE_API_KEY)]

    assert pages == []
    assert fetched == []


@pytest.mark.asyncio
@respx.mock
async def test_fetch_sources_stream_skips_none_fetches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pages that return None from the fetcher are not yielded."""
    urls = ["https://example.com/ok", "https://example.com/dead"]

    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=Response(200, json=_make_brave_response(urls))
    )

    async def _mock_fetch(url: str) -> PageContent | None:
        if url.endswith("dead"):
            return None
        return PageContent(url=url, text="content " * 20, title="Title")

    fetcher = AsyncFetcher()
    monkeypatch.setattr(fetcher, "fetch", _mock_fetch)

    queries = [SearchQuery(query="q", source_category="nonprofits", issue_area="housing_affordability")]
    pages = [p async for p in fetch_sources_stream(queries, fetcher, _FAKE_API_KEY)]

    assert len(pages) == 1
    assert pages[0].url == "https://example.com/ok"


@pytest.mark.asyncio
@respx.mock
async def test_search_brave_passes_country_and_freshness_filters() -> None:
    """Country and freshness filters are forwarded to the Brave API."""
    route = respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=Response(200, json=_make_brave_response(["https://example.com/q"]))
    )

    results = await _search_brave(
        ["filtered query"],
        _FAKE_API_KEY,
        country="US",
        freshness="py",
    )

    assert len(results) == 1
    request = route.calls[0].request
    assert "country=US" in str(request.url)
    assert "freshness=py" in str(request.url)


@pytest.mark.asyncio
async def test_fetch_sources_stream_accepts_async_iterator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An async iterator of queries is fully consumed before searching."""
    async def _async_queries():
        yield SearchQuery(
            query="async-q",
            source_category="nonprofits",
            issue_area="housing_affordability",
        )

    async def _stub_search(_queries, _api_key):
        return [{"url": "https://example.com/async"}]

    async def _mock_fetch(url: str) -> PageContent | None:
        return PageContent(url=url, text="x" * 50, title="t")

    from atlas_scout.steps import source_fetch as source_fetch_module
    monkeypatch.setattr(source_fetch_module, "_search_brave", _stub_search)
    fetcher = AsyncFetcher()
    monkeypatch.setattr(fetcher, "fetch", _mock_fetch)

    pages = [
        p async for p in fetch_sources_stream(_async_queries(), fetcher, _FAKE_API_KEY)
    ]

    assert [page.url for page in pages] == ["https://example.com/async"]


@pytest.mark.asyncio
@respx.mock
async def test_search_brave_logs_and_continues_on_http_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A failing search does not raise; it logs and returns whatever was collected."""
    respx.get(_BRAVE_SEARCH_URL).mock(return_value=Response(503, json={"error": "fail"}))

    with caplog.at_level("WARNING", logger="atlas_scout.steps.source_fetch"):
        results = await _search_brave(["any"], _FAKE_API_KEY)

    assert results == []
    assert any("Brave search failed" in r.message for r in caplog.records)


def test_results_per_query_for_depth() -> None:
    """The depth-to-count helper supports known and unknown depths."""
    from atlas_scout.steps.source_fetch import results_per_query_for_depth

    assert results_per_query_for_depth("standard") == 5
    assert results_per_query_for_depth("deep") == 15
    assert results_per_query_for_depth("unknown-depth") == 5
