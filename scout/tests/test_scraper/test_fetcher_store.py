"""Store-claim behavior tests for atlas_scout.scraper.fetcher.AsyncFetcher."""

from __future__ import annotations

import httpx
import pytest
import respx

from atlas_scout.scraper import fetcher as fetcher_module
from atlas_scout.scraper.fetcher import AsyncFetcher

from .fetcher_support import _FakeStore, article_html


@respx.mock
async def test_fetch_with_store_claims_and_completes() -> None:
    store = _FakeStore()
    respx.get("https://example.com/claim").mock(
        return_value=httpx.Response(
            200, text=article_html("Body content with enough length about housing policy. ")
        )
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    fetcher.bind_run("run-x")
    result = await fetcher.fetch("https://example.com/claim")
    await fetcher.close()
    assert result is not None
    assert store.completed == ["fetch:https://example.com/claim"]


@respx.mock
async def test_fetch_with_store_fail_work_on_exception() -> None:
    store = _FakeStore()
    respx.get("https://example.com/explode").mock(side_effect=RuntimeError("kaboom"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="kaboom"):
        await fetcher.fetch("https://example.com/explode")
    await fetcher.close()
    assert store.failed == [("fetch:https://example.com/explode", "kaboom")]


@respx.mock
async def test_fetch_caches_negative_result_when_request_fails() -> None:
    store = _FakeStore()
    respx.get("https://example.com/dead").mock(side_effect=httpx.ConnectError("nope"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/dead")
    await fetcher.close()
    assert result is None
    assert any(
        meta.get("status") == "filtered" and meta.get("reason") == "connect_error"
        for _url, _text, meta in store.cache_calls
    )


@respx.mock
async def test_fetch_returns_cached_after_lost_claim_race() -> None:
    cached_metadata = {
        "status": "fetched",
        "title": "Cached Title",
        "discovered_links": ["https://example.com/x"],
        "publication": "Pub",
        "published_date": "2024-01-02T00:00:00",
        "source_type": "website",
    }
    cached_payload = {"text": "Cached body " * 80, "metadata": cached_metadata}
    store = _FakeStore(cached=None, cached_after_first_call=cached_payload, claim_returns=[False])
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/raced")
    await fetcher.close()
    assert result is not None
    assert result.title == "Cached Title"


async def test_fetch_returns_filtered_outcome_when_cache_status_not_fetched() -> None:
    cached_metadata = {
        "status": "filtered",
        "reason": "content_below_min_words",
        "discovered_links": [],
        "title": "",
    }
    cached_payload = {"text": "", "metadata": cached_metadata}
    store = _FakeStore(cached=cached_payload)
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/already-filtered")
    await fetcher.close()
    assert result is None


async def test_fetch_returns_filtered_outcome_when_cache_status_fetched_but_empty_text() -> None:
    cached_payload = {"text": "   ", "metadata": {"status": "fetched"}}
    store = _FakeStore(cached=cached_payload)
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/empty-cache")
    await fetcher.close()
    assert result is None


@respx.mock
async def test_fetch_shared_claim_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    inflight_claim = {"status": "inflight"}
    store = _FakeStore(
        cached=None,
        cached_after_first_call=None,
        claim_returns=[False, False],
        get_work_claim_returns=[inflight_claim, inflight_claim],
    )

    times = iter([0.0, 0.0, 1e9, 1e9])

    class FakeLoop:
        def time(self) -> float:
            return next(times)

    monkeypatch.setattr(fetcher_module.asyncio, "get_running_loop", lambda: FakeLoop())
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(fetcher_module.asyncio, "sleep", fake_sleep)

    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/timeout")
    await fetcher.close()
    assert result is None
    assert sleeps == [0.25]


@respx.mock
async def test_fetch_polls_when_claim_status_not_inflight() -> None:
    respx.get("https://example.com/retry").mock(
        return_value=httpx.Response(
            200, text=article_html("Body content with enough length about housing policy. ")
        )
    )
    store = _FakeStore(
        cached=None,
        cached_after_first_call=None,
        claim_returns=[False, True],
        get_work_claim_returns=[{"status": "completed"}],
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/retry")
    await fetcher.close()
    assert result is not None
