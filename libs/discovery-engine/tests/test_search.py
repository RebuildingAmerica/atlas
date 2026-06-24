"""Tests for the vendor-neutral search provider abstraction."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import httpx

from atlas_discovery_engine.search import (
    BraveSearchProvider,
    FallbackSearchProvider,
    SearchProvider,
    SearchResult,
    StaticSearchProvider,
)


class _StubProvider(SearchProvider):
    """A trivial in-memory provider proving the abstract contract."""

    def __init__(self, canned: list[SearchResult]) -> None:
        self._canned = canned

    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        return list(self._canned) if queries else []


class TestSearchProviderContract:
    """The ABC defines the contract concrete providers must honor."""

    async def test_concrete_provider_returns_canned_results(self) -> None:
        """A concrete subclass returns its results for non-empty queries."""
        canned = [
            SearchResult(
                url="https://example.com/story",
                title="Story",
                publication="Example News",
                published="2026-01-15",
            )
        ]
        provider = _StubProvider(canned)

        results = await provider.search(["housing"])

        assert results == canned

    async def test_concrete_provider_returns_empty_for_no_queries(self) -> None:
        """An empty query sequence yields no results."""
        provider = _StubProvider(
            [
                SearchResult(
                    url="https://example.com/story",
                    title="Story",
                    publication="Example News",
                    published="2026-01-15",
                )
            ]
        )

        assert await provider.search([]) == []


def _brave_payload() -> dict[str, Any]:
    return {
        "web": {
            "results": [
                {
                    "url": "https://example.com/story",
                    "title": "Story",
                    "profile": {"name": "Example News"},
                    "age": "2026-01-15",
                },
                {
                    "url": "https://example.com/other",
                    "title": "Other",
                    "profile": {},
                    "age": "3 days ago",
                },
            ]
        }
    }


class _FakeResponse:
    """A minimal stand-in for an httpx.Response."""

    def __init__(
        self,
        *,
        status_code: int,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://api.search.brave.com")
            response = httpx.Response(self.status_code, request=request, headers=self.headers)
            raise httpx.HTTPStatusError("error", request=request, response=response)

    def json(self) -> dict[str, Any]:
        return self._payload


class _ScriptedClient:
    """A fake AsyncClient yielding a scripted sequence of responses/exceptions."""

    def __init__(self, script: list[object]) -> None:
        self._script = list(script)
        self.calls = 0

    async def __aenter__(self) -> _ScriptedClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def get(self, _url: str, **_kwargs: object) -> _FakeResponse:
        item = self._script[self.calls]
        self.calls += 1
        if isinstance(item, Exception):
            raise item
        assert isinstance(item, _FakeResponse)
        return item


class TestBraveSearchProvider:
    """The Brave adapter maps results and survives rate limits and outages."""

    async def test_maps_brave_results_into_search_results(self, monkeypatch: Any) -> None:
        """A successful response maps web.results into SearchResult fields."""
        client = _ScriptedClient([_FakeResponse(status_code=200, payload=_brave_payload())])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        provider = BraveSearchProvider(api_key="test-key")
        results = await provider.search(["housing"])

        assert results == [
            SearchResult(
                url="https://example.com/story",
                title="Story",
                publication="Example News",
                published="2026-01-15",
            ),
            SearchResult(
                url="https://example.com/other",
                title="Other",
                publication=None,
                published=None,
            ),
        ]

    async def test_treats_a_missing_age_as_undated(self, monkeypatch: Any) -> None:
        """A result with no age field maps to a None published date."""
        payload = {
            "web": {
                "results": [
                    {
                        "url": "https://example.com/undated",
                        "title": "Undated",
                        "profile": {"name": "Example News"},
                    }
                ]
            }
        }
        client = _ScriptedClient([_FakeResponse(status_code=200, payload=payload)])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        provider = BraveSearchProvider(api_key="test-key")
        results = await provider.search(["housing"])

        assert results == [
            SearchResult(
                url="https://example.com/undated",
                title="Undated",
                publication="Example News",
                published=None,
            )
        ]

    async def test_skips_results_missing_a_url(self, monkeypatch: Any) -> None:
        """Brave results without a URL are dropped, not emitted as empty rows."""
        payload = {"web": {"results": [{"title": "No URL"}]}}
        client = _ScriptedClient([_FakeResponse(status_code=200, payload=payload)])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        provider = BraveSearchProvider(api_key="test-key")

        assert await provider.search(["housing"]) == []

    async def test_retries_after_a_429_then_succeeds(self, monkeypatch: Any) -> None:
        """A 429 with Retry-After is honored, then the retry's results are used."""
        client = _ScriptedClient(
            [
                _FakeResponse(status_code=429, headers={"Retry-After": "2"}),
                _FakeResponse(status_code=200, payload=_brave_payload()),
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        slept: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            slept.append(seconds)

        provider = BraveSearchProvider(api_key="test-key", sleep=fake_sleep)
        results = await provider.search(["housing"])

        assert client.calls == 2
        assert slept == [2.0]
        assert results[0].url == "https://example.com/story"

    async def test_persistent_429_skips_the_query_without_raising(self, monkeypatch: Any) -> None:
        """When every attempt is rate-limited, the query yields nothing and does not raise."""
        client = _ScriptedClient(
            [_FakeResponse(status_code=429, headers={"Retry-After": "1"}) for _ in range(5)]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        slept: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            slept.append(seconds)

        provider = BraveSearchProvider(api_key="test-key", max_retries=2, sleep=fake_sleep)

        assert await provider.search(["housing"]) == []
        # initial attempt + 2 retries = 3 calls; sleeps only between attempts.
        assert client.calls == 3
        assert slept == [1.0, 1.0]

    async def test_caps_an_unparseable_retry_after_at_the_ceiling(self, monkeypatch: Any) -> None:
        """A missing or non-numeric Retry-After falls back to the bounded default."""
        client = _ScriptedClient(
            [
                _FakeResponse(status_code=429, headers={"Retry-After": "not-a-number"}),
                _FakeResponse(status_code=200, payload=_brave_payload()),
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        slept: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            slept.append(seconds)

        provider = BraveSearchProvider(api_key="test-key", sleep=fake_sleep)
        await provider.search(["housing"])

        assert slept == [BraveSearchProvider.DEFAULT_RETRY_SECONDS]

    async def test_bounds_a_huge_retry_after(self, monkeypatch: Any) -> None:
        """A very large Retry-After is clamped to the max so a run cannot stall."""
        client = _ScriptedClient(
            [
                _FakeResponse(status_code=429, headers={"Retry-After": "9999"}),
                _FakeResponse(status_code=200, payload=_brave_payload()),
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        slept: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            slept.append(seconds)

        provider = BraveSearchProvider(api_key="test-key", sleep=fake_sleep)
        await provider.search(["housing"])

        assert slept == [BraveSearchProvider.MAX_RETRY_SECONDS]

    async def test_non_429_status_error_skips_the_query(self, monkeypatch: Any) -> None:
        """A non-rate-limit HTTP error skips that query without retrying or raising."""
        client = _ScriptedClient([_FakeResponse(status_code=500)])
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        provider = BraveSearchProvider(api_key="test-key")

        assert await provider.search(["housing"]) == []
        assert client.calls == 1

    async def test_request_error_skips_the_query(self, monkeypatch: Any) -> None:
        """A transport-level error skips the query, returning partial results."""
        request = httpx.Request("GET", "https://api.search.brave.com")
        client = _ScriptedClient(
            [
                httpx.ConnectError("boom", request=request),
                _FakeResponse(status_code=200, payload=_brave_payload()),
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        provider = BraveSearchProvider(api_key="test-key")
        results = await provider.search(["first", "second"])

        # First query errors out and is skipped; second query succeeds.
        assert [result.url for result in results] == [
            "https://example.com/story",
            "https://example.com/other",
        ]

    async def test_aggregates_results_across_multiple_queries(self, monkeypatch: Any) -> None:
        """Results from several queries are concatenated in order."""
        client = _ScriptedClient(
            [
                _FakeResponse(status_code=200, payload=_brave_payload()),
                _FakeResponse(status_code=200, payload=_brave_payload()),
            ]
        )
        monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)

        provider = BraveSearchProvider(api_key="test-key")
        results = await provider.search(["a", "b"])

        assert len(results) == 4


def _result(url: str) -> SearchResult:
    return SearchResult(url=url, title=None, publication=None, published=None)


class _RecordingProvider(SearchProvider):
    """A provider that records its calls and returns canned (or raised) output."""

    def __init__(
        self, *, results: list[SearchResult] | None = None, error: Exception | None = None
    ) -> None:
        self._results = results or []
        self._error = error
        self.calls: list[list[str]] = []

    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        self.calls.append(list(queries))
        if self._error is not None:
            raise self._error
        return list(self._results)


class TestStaticSearchProvider:
    """The static provider yields a fixed result set as a no-network fallback."""

    async def test_returns_its_canned_results(self) -> None:
        canned = [_result("https://example.com/a")]
        provider = StaticSearchProvider(canned)

        assert await provider.search(["anything"]) == canned

    async def test_returns_empty_for_no_queries(self) -> None:
        provider = StaticSearchProvider([_result("https://example.com/a")])

        assert await provider.search([]) == []


class TestFallbackSearchProvider:
    """Fallback engages only when the primary yields nothing or fails."""

    async def test_uses_primary_results_when_present(self) -> None:
        primary = _RecordingProvider(results=[_result("https://primary/a")])
        fallback = _RecordingProvider(results=[_result("https://fallback/a")])
        provider = FallbackSearchProvider(primary=primary, fallback=fallback)

        results = await provider.search(["housing"])

        assert [r.url for r in results] == ["https://primary/a"]
        assert fallback.calls == []

    async def test_falls_back_when_primary_is_empty(self) -> None:
        primary = _RecordingProvider(results=[])
        fallback = _RecordingProvider(results=[_result("https://fallback/a")])
        provider = FallbackSearchProvider(primary=primary, fallback=fallback)

        results = await provider.search(["housing"])

        assert [r.url for r in results] == ["https://fallback/a"]
        assert primary.calls == [["housing"]]
        assert fallback.calls == [["housing"]]

    async def test_falls_back_when_primary_raises(self) -> None:
        primary = _RecordingProvider(error=RuntimeError("primary down"))
        fallback = _RecordingProvider(results=[_result("https://fallback/a")])
        provider = FallbackSearchProvider(primary=primary, fallback=fallback)

        results = await provider.search(["housing"])

        assert [r.url for r in results] == ["https://fallback/a"]
        assert fallback.calls == [["housing"]]

    async def test_returns_empty_when_both_are_empty(self) -> None:
        primary = _RecordingProvider(results=[])
        fallback = _RecordingProvider(results=[])
        provider = FallbackSearchProvider(primary=primary, fallback=fallback)

        assert await provider.search(["housing"]) == []
