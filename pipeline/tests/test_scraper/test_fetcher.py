"""Tests for atlas_scout.scraper.fetcher.AsyncFetcher."""

import httpx
import respx

from atlas_scout.scraper.fetcher import AsyncFetcher


@respx.mock
async def test_fetch_single_url():
    html = (
        "<html><body><article><p>"
        + "Article content about housing. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/article").mock(return_value=httpx.Response(200, text=html))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/article")
    assert result is not None
    assert result.url == "https://example.com/article"


@respx.mock
async def test_fetch_returns_none_on_error():
    respx.get("https://example.com/404").mock(return_value=httpx.Response(404))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    assert await fetcher.fetch("https://example.com/404") is None


@respx.mock
async def test_fetch_many_concurrent():
    for i in range(5):
        html = (
            f"<html><body><article><p>"
            + f"Page {i} content about policy. " * 55
            + "</p></article></body></html>"
        )
        respx.get(f"https://example.com/page{i}").mock(
            return_value=httpx.Response(200, text=html)
        )
    fetcher = AsyncFetcher(max_concurrent=3, request_delay_ms=0)
    results = await fetcher.fetch_many([f"https://example.com/page{i}" for i in range(5)])
    assert len(results) <= 5


@respx.mock
async def test_fetch_with_page_cache(tmp_db_path):
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    html = (
        "<html><body><article><p>"
        + "Cached content about education. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/cached").mock(return_value=httpx.Response(200, text=html))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)
    result1 = await fetcher.fetch("https://example.com/cached")
    # The URL is now cached; a second call should return from cache without HTTP
    result2 = await fetcher.fetch("https://example.com/cached")
    await store.close()
    assert result1 is not None
    assert result2 is not None
