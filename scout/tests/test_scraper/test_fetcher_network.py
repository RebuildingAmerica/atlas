"""Network and cache behavior tests for atlas_scout.scraper.fetcher.AsyncFetcher."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest  # noqa: TC002
import respx

from atlas_scout.scraper import fetcher as fetcher_module
from atlas_scout.scraper.fetcher import AsyncFetcher

from .fetcher_support import article_html

if TYPE_CHECKING:
    from pathlib import Path


@respx.mock
async def test_fetch_single_url() -> None:
    respx.get("https://example.com/article").mock(
        return_value=httpx.Response(200, text=article_html("Article content about housing. "))
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/article")
    await fetcher.close()
    assert result is not None
    assert result.url == "https://example.com/article"


@respx.mock
async def test_fetch_returns_none_on_error() -> None:
    respx.get("https://example.com/404").mock(return_value=httpx.Response(404))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    assert await fetcher.fetch("https://example.com/404") is None
    await fetcher.close()


@respx.mock
async def test_fetch_many_concurrent() -> None:
    for i in range(5):
        respx.get(f"https://example.com/page{i}").mock(
            return_value=httpx.Response(200, text=article_html(f"Page {i} content about policy. "))
        )
    fetcher = AsyncFetcher(max_concurrent=3, request_delay_ms=0)
    results = await fetcher.fetch_many([f"https://example.com/page{i}" for i in range(5)])
    await fetcher.close()
    assert len(results) <= 5


@respx.mock
async def test_fetch_with_page_cache(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    respx.get("https://example.com/cached").mock(
        return_value=httpx.Response(200, text=article_html("Cached content about education. "))
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)
    result1 = await fetcher.fetch("https://example.com/cached")
    result2 = await fetcher.fetch("https://example.com/cached")
    await fetcher.close()
    await store.close()
    assert result1 is not None
    assert result2 is not None


@respx.mock
async def test_fetch_uses_stale_cache_by_default(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    await store.cache_page("https://example.com/stale", "Cached body " * 55, {"title": "Cached"})
    await store._db.execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com/stale",),
    )

    route = respx.get("https://example.com/stale").mock(
        return_value=httpx.Response(
            200,
            text="<html><body><article><p>" + "Fresh body " * 120 + "</p></article></body></html>",
        )
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        store=store,
        revisit_cached_urls=False,
    )
    result = await fetcher.fetch("https://example.com/stale")
    await fetcher.close()
    await store.close()
    assert result is not None
    assert result.title == "Cached"
    assert route.call_count == 0


@respx.mock
async def test_fetch_refresh_override_refetches_stale_page(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    await store.cache_page("https://example.com/stale", "Cached body " * 55, {"title": "Cached"})
    await store._db.execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com/stale",),
    )

    route = respx.get("https://example.com/stale").mock(
        return_value=httpx.Response(
            200,
            text="<html><body><article><p>" + "Fresh body " * 120 + "</p></article></body></html>",
        )
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        store=store,
        revisit_cached_urls=True,
        page_cache_ttl_days=7,
    )
    result = await fetcher.fetch("https://example.com/stale")
    await fetcher.close()
    await store.close()
    assert result is not None
    assert "Fresh body" in result.text
    assert route.call_count == 1


def test_max_concurrent_property_and_bind_run() -> None:
    fetcher = AsyncFetcher(max_concurrent=7, request_delay_ms=0)
    assert fetcher.max_concurrent == 7
    fetcher.bind_run("run-123")
    assert fetcher._run_id == "run-123"


@respx.mock
async def test_fetch_tracked_returns_page() -> None:
    respx.get("https://example.com/tracked").mock(
        return_value=httpx.Response(
            200, text=article_html("Article body content covering planning. ")
        )
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    page = await fetcher.fetch_tracked("https://example.com/tracked", task_id="t-1", _store=None)
    await fetcher.close()
    assert page is not None
    assert page.task_id == "t-1"


@respx.mock
async def test_fetch_network_request_delay_sleeps(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(fetcher_module.asyncio, "sleep", fake_sleep)
    respx.get("https://example.com/delayed").mock(
        return_value=httpx.Response(
            200, text=article_html("Body content with enough length about policy. ")
        )
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=50)
    result = await fetcher.fetch("https://example.com/delayed")
    await fetcher.close()
    assert result is not None
    assert any(s == 0.05 for s in sleeps)


@respx.mock
async def test_fetch_network_handles_request_error() -> None:
    respx.get("https://example.com/dead").mock(side_effect=httpx.ConnectError("nope"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/dead")
    await fetcher.close()
    assert result is None


@respx.mock
async def test_fetch_network_handles_timeout() -> None:
    respx.get("https://example.com/slow").mock(side_effect=httpx.TimeoutException("slow"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/slow")
    await fetcher.close()
    assert result is None


@respx.mock
async def test_fetch_network_handles_generic_request_error() -> None:
    respx.get("https://example.com/oops").mock(side_effect=httpx.RequestError("oops"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/oops")
    await fetcher.close()
    assert result is None


def test_error_reason_branches() -> None:
    response = httpx.Response(500, request=httpx.Request("GET", "https://example.com"))
    status_err = httpx.HTTPStatusError("boom", request=response.request, response=response)
    connect_err = httpx.ConnectError("nope")
    timeout_err = httpx.TimeoutException("slow")
    other_err = httpx.RequestError("other")

    assert AsyncFetcher._error_reason(status_err) == "http_500"
    assert AsyncFetcher._error_reason(connect_err) == "connect_error"
    assert AsyncFetcher._error_reason(timeout_err) == "timeout"
    assert AsyncFetcher._error_reason(other_err) == "request_error"
