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
