"""Tests for atlas_scout.scraper.fetcher.AsyncFetcher."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, ClassVar

import httpx
import pytest
import respx
from atlas_shared import PageContent, SourceType

if TYPE_CHECKING:
    from pathlib import Path

from atlas_scout.scraper import fetcher as fetcher_module
from atlas_scout.scraper.fetcher import (
    AsyncFetcher,
    _coerce_discovered_links,
    _extract_pdf_content,
    _parse_cached_datetime,
    _parse_source_type,
)


@respx.mock
async def test_fetch_single_url() -> None:
    html = (
        "<html><body><article><p>"
        + "Article content about housing. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/article").mock(return_value=httpx.Response(200, text=html))
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
        html = (
            "<html><body><article><p>"
            + f"Page {i} content about policy. " * 55
            + "</p></article></body></html>"
        )
        respx.get(f"https://example.com/page{i}").mock(return_value=httpx.Response(200, text=html))
    fetcher = AsyncFetcher(max_concurrent=3, request_delay_ms=0)
    results = await fetcher.fetch_many([f"https://example.com/page{i}" for i in range(5)])
    await fetcher.close()
    assert len(results) <= 5


@respx.mock
async def test_fetch_with_page_cache(tmp_db_path: Path) -> None:
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
    await store._execute(
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
    await store._execute(
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


# ----- additional coverage -----


def test_max_concurrent_property_and_bind_run() -> None:
    fetcher = AsyncFetcher(max_concurrent=7, request_delay_ms=0)
    assert fetcher.max_concurrent == 7
    fetcher.bind_run("run-123")
    assert fetcher._run_id == "run-123"


@respx.mock
async def test_fetch_tracked_returns_page() -> None:
    html = (
        "<html><body><article><p>"
        + "Article body content covering planning. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/tracked").mock(return_value=httpx.Response(200, text=html))
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

    html = (
        "<html><body><article><p>"
        + "Body content with enough length about policy. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/delayed").mock(return_value=httpx.Response(200, text=html))
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


@respx.mock
async def test_fetch_filtered_when_extraction_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # Force trafilatura to return None so the page is filtered.
    from atlas_scout.scraper import extractor as extractor_module

    monkeypatch.setattr(extractor_module.trafilatura, "extract", lambda _html, **_: None)
    respx.get("https://example.com/empty").mock(
        return_value=httpx.Response(200, text="<html><body><p>x</p></body></html>")
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/empty")
    await fetcher.close()
    assert result is None


@respx.mock
async def test_fetch_uses_browser_fallback_for_news_app_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """High-value JS-heavy news pages should get one bounded browser render pass."""
    from atlas_scout.scraper.extractor import ContentExtraction

    rendered_page = PageContent(
        url="https://news.example.com/local/civic-story",
        text="Rendered story names a local civic leader and organization. " * 80,
        title="Rendered civic story",
        source_type=SourceType.NEWS_ARTICLE,
        discovered_links=["https://news.example.com/local/follow-up"],
    )
    calls: list[str] = []

    async def fake_render(url: str, *, timeout_ms: int) -> ContentExtraction:
        calls.append(f"{url}:{timeout_ms}")
        return ContentExtraction(
            page=rendered_page,
            reason=None,
            discovered_links=rendered_page.discovered_links,
        )

    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    respx.get("https://news.example.com/local/civic-story").mock(
        return_value=httpx.Response(
            200,
            text="<html><body><div id='root'></div><script src='/app.js'></script></body></html>",
        )
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
        browser_render_timeout_ms=1234,
    )
    result = await fetcher.fetch("https://news.example.com/local/civic-story")

    await fetcher.close()

    assert result is not None
    assert result.text == rendered_page.text
    assert result.discovered_links == ["https://news.example.com/local/follow-up"]
    assert calls == ["https://news.example.com/local/civic-story:1234"]


@respx.mock
async def test_fetch_uses_browser_fallback_for_sparse_civic_roster(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Civic rosters that lose rendered names should get a bounded browser pass."""
    from atlas_scout.scraper.extractor import ContentExtraction

    sparse_page = PageContent(
        url="https://example.gov/government/mayor-city-council",
        text="\n".join(
            [
                "Mayor and City Council positions are elected by registered voters.",
                "Mayor",
                "Councilman Ward 1",
                "Councilwoman Ward 2",
            ]
        ),
        title="Mayor and City Council",
    )
    rendered_page = PageContent(
        url="https://example.gov/government/mayor-city-council",
        text="\n".join(
            [
                "Shelley Berkley",
                "Mayor",
                "Brian Knudsen",
                "Councilman Ward 1",
            ]
        ),
        title="Mayor and City Council",
        discovered_links=["https://example.gov/government/mayor"],
    )
    calls: list[str] = []

    def fake_extract(_html: str, *, url: str) -> ContentExtraction:
        del url
        return ContentExtraction(page=sparse_page, reason=None, discovered_links=[])

    async def fake_render(url: str, *, timeout_ms: int) -> ContentExtraction:
        calls.append(f"{url}:{timeout_ms}")
        return ContentExtraction(
            page=rendered_page,
            reason=None,
            discovered_links=rendered_page.discovered_links,
        )

    monkeypatch.setattr(fetcher_module, "extract_content_verbose", fake_extract)
    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    respx.get("https://example.gov/government/mayor-city-council").mock(
        return_value=httpx.Response(200, text="<html><body>shell</body></html>")
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
        browser_render_timeout_ms=1234,
    )
    result = await fetcher.fetch("https://example.gov/government/mayor-city-council")

    await fetcher.close()

    assert result is not None
    assert "Shelley Berkley" in result.text
    assert result.discovered_links == ["https://example.gov/government/mayor"]
    assert calls == ["https://example.gov/government/mayor-city-council:1234"]


@respx.mock
async def test_fetch_skips_browser_fallback_for_low_value_thin_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Thin ordinary pages should not burn browser CPU."""

    async def fake_render(url: str, *, timeout_ms: int) -> Any:
        raise AssertionError(f"unexpected browser render for {url}:{timeout_ms}")

    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    respx.get("https://example.com/tiny").mock(
        return_value=httpx.Response(200, text="<html><body><p>tiny</p></body></html>")
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
    )
    result = await fetcher.fetch("https://example.com/tiny")

    await fetcher.close()

    assert result is None


@respx.mock
async def test_fetch_browser_fallback_respects_per_fetcher_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Browser rendering should be capped so a run cannot spend unbounded CPU."""
    from atlas_scout.scraper.extractor import ContentExtraction

    calls: list[str] = []

    async def fake_render(url: str, *, timeout_ms: int) -> ContentExtraction:
        del timeout_ms
        calls.append(url)
        return ContentExtraction(
            page=PageContent(
                url=url,
                text="Rendered civic article body. " * 80,
                title="Rendered",
                source_type=SourceType.NEWS_ARTICLE,
            ),
            reason=None,
            discovered_links=[],
        )

    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    for suffix in ("one", "two"):
        respx.get(f"https://news.example.com/local/{suffix}").mock(
            return_value=httpx.Response(
                200,
                text="<html><body><div id='__next'></div><script></script></body></html>",
            )
        )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
        max_browser_renders_per_run=1,
    )
    first = await fetcher.fetch("https://news.example.com/local/one")
    second = await fetcher.fetch("https://news.example.com/local/two")

    await fetcher.close()

    assert first is not None
    assert second is None
    assert calls == ["https://news.example.com/local/one"]


@respx.mock
async def test_fetch_pdf_content_type_routes_to_pdf_extractor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_text = "PDF document body discussing civic matters. " * 50
    pdf_page = PageContent(url="https://example.com/doc.pdf", text=long_text, title="PDF Title")

    def fake_pdf(data: bytes, *, url: str) -> Any:
        del data, url
        from atlas_scout.scraper.extractor import ContentExtraction

        return ContentExtraction(page=pdf_page, reason=None, discovered_links=[])

    monkeypatch.setattr(fetcher_module, "_extract_pdf_content", fake_pdf)
    respx.get("https://example.com/doc.pdf").mock(
        return_value=httpx.Response(
            200,
            content=b"%PDF-1.4 fake bytes",
            headers={"content-type": "application/pdf"},
        )
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/doc.pdf")
    await fetcher.close()
    assert result is not None
    assert result.text == long_text


# ---- shared store / claim path ----


class _FakeStore:
    """Stand-in for ScoutStore exercising the claim/cache path."""

    def __init__(
        self,
        *,
        cached: dict[str, Any] | None = None,
        cached_after_first_call: dict[str, Any] | None = None,
        claim_returns: list[bool] | None = None,
        get_work_claim_returns: list[dict[str, Any] | None] | None = None,
    ) -> None:
        self._cached_initial = cached
        self._cached_after = cached_after_first_call
        self._cache_calls = 0
        self._claim_returns = list(claim_returns or [True])
        self._claim_idx = 0
        self._gwc = list(get_work_claim_returns or [])
        self._gwc_idx = 0
        self.completed: list[str] = []
        self.failed: list[tuple[str, str]] = []
        self.cache_calls: list[tuple[str, str, dict[str, Any]]] = []

    async def get_cached_page(self, url: str, ttl_days: int | None = 7) -> dict[str, Any] | None:
        del url, ttl_days
        self._cache_calls += 1
        if self._cache_calls == 1:
            return self._cached_initial
        return self._cached_after

    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None:
        self.cache_calls.append((url, text, metadata))

    async def claim_work(self, key: str, *, owner_run_id: str, lease_seconds: int = 120) -> bool:
        del key, owner_run_id, lease_seconds
        if self._claim_idx >= len(self._claim_returns):
            return False
        value = self._claim_returns[self._claim_idx]
        self._claim_idx += 1
        return value

    async def complete_work(self, key: str) -> None:
        self.completed.append(key)

    async def fail_work(self, key: str, error: str) -> None:
        self.failed.append((key, error))

    async def get_work_claim(self, key: str) -> dict[str, Any] | None:
        del key
        if self._gwc_idx >= len(self._gwc):
            return None
        value = self._gwc[self._gwc_idx]
        self._gwc_idx += 1
        return value


@respx.mock
async def test_fetch_with_store_claims_and_completes() -> None:
    store = _FakeStore()
    html = (
        "<html><body><article><p>"
        + "Body content with enough length about housing policy. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/claim").mock(return_value=httpx.Response(200, text=html))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    fetcher.bind_run("run-x")
    result = await fetcher.fetch("https://example.com/claim")
    await fetcher.close()
    assert result is not None
    assert store.completed == ["fetch:https://example.com/claim"]


@respx.mock
async def test_fetch_with_store_fail_work_on_exception() -> None:
    store = _FakeStore()
    # Make the network raise an unexpected error during reading the response.
    respx.get("https://example.com/explode").mock(side_effect=RuntimeError("kaboom"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="kaboom"):
        await fetcher.fetch("https://example.com/explode")
    await fetcher.close()
    assert store.failed == [("fetch:https://example.com/explode", "kaboom")]


@respx.mock
async def test_fetch_caches_negative_result_when_request_fails() -> None:
    """An httpx error path with a store present should persist a negative cache entry."""
    store = _FakeStore()
    respx.get("https://example.com/dead").mock(side_effect=httpx.ConnectError("nope"))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)  # type: ignore[arg-type]
    result = await fetcher.fetch("https://example.com/dead")
    await fetcher.close()
    assert result is None
    # The negative cache call recorded the connect_error reason.
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
    store = _FakeStore(
        cached=None,
        cached_after_first_call=cached_payload,
        claim_returns=[False],
    )
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
    """When another runner holds the claim and the deadline expires, return shared_fetch_timeout."""
    # Always lose the claim race, no cached result, claim shows inflight forever.
    inflight_claim = {"status": "inflight"}
    store = _FakeStore(
        cached=None,
        cached_after_first_call=None,
        claim_returns=[False, False],
        get_work_claim_returns=[inflight_claim, inflight_claim],
    )

    # Stub the loop time so the deadline elapses on the first iteration.
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
    assert result is None  # the outcome page is None on timeout


@respx.mock
async def test_fetch_polls_when_claim_status_not_inflight() -> None:
    """If the claim is missing or not inflight on poll, the loop continues to retry the claim."""
    html = (
        "<html><body><article><p>"
        + "Body content with enough length about housing policy. " * 55
        + "</p></article></body></html>"
    )
    respx.get("https://example.com/retry").mock(return_value=httpx.Response(200, text=html))

    # First claim attempt loses, no cache hit, claim shows status='completed' (not inflight)
    # so we ``continue`` and try claim again — which now wins.
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


# ----- module-level helpers -----


def test_parse_cached_datetime_variants() -> None:
    assert _parse_cached_datetime(None) is None
    assert _parse_cached_datetime("") is None
    when = datetime(2024, 1, 2, 3, 4, 5)  # noqa: DTZ001 — naive parser output
    assert _parse_cached_datetime(when) == when
    expected = datetime(2024, 1, 2, 3, 4, 5)  # noqa: DTZ001 — naive parser output
    assert _parse_cached_datetime("2024-01-02T03:04:05") == expected
    assert _parse_cached_datetime("not-a-date") is None
    assert _parse_cached_datetime(12345) is None


def test_parse_source_type_variants() -> None:
    assert _parse_source_type(SourceType.NEWS_ARTICLE) == SourceType.NEWS_ARTICLE
    assert _parse_source_type("website") == SourceType.WEBSITE
    assert _parse_source_type("not-a-real-type") == SourceType.WEBSITE
    assert _parse_source_type(None) == SourceType.WEBSITE


def test_coerce_discovered_links_variants() -> None:
    assert _coerce_discovered_links(["a", "b"]) == ["a", "b"]
    assert _coerce_discovered_links(["a", "", None]) == ["a", "None"]
    assert _coerce_discovered_links(None) == []
    assert _coerce_discovered_links("not a list") == []


# ----- PDF extractor helpers -----


def test_extract_pdf_content_no_pymupdf_returns_unavailable() -> None:
    # pymupdf is not installed in the test env — exercise the ImportError path directly.
    result = _extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "pdf_extraction_unavailable"


def test_extract_pdf_content_open_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_module = type("fake", (), {})()

    def boom(**_: Any) -> Any:
        raise RuntimeError("bad pdf")

    fake_module.open = boom  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = _extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "pdf_extraction_failed"


def test_extract_pdf_content_text_too_short(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePage:
        def get_text(self) -> str:
            return "tiny"

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": "Doc"}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = _extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "content_below_min_words"


def test_extract_pdf_content_empty_text(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePage:
        def get_text(self) -> str:
            return ""

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": ""}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = _extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "content_below_min_words"


def test_extract_pdf_content_success(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Substantial PDF body discussing public policy. " * 60

    class FakePage:
        def get_text(self) -> str:
            return long_text

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": "Annual Report"}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = _extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is not None
    assert result.page.title == "Annual Report"
    assert result.page.source_type == SourceType.REPORT


def test_extract_pdf_content_missing_title_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Substantial PDF body discussing public policy. " * 60

    class FakePage:
        def get_text(self) -> str:
            return long_text

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = _extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is not None
    assert result.page.title == ""
