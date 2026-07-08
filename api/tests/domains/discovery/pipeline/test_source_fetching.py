"""Discovery source fetching helper tests."""

from __future__ import annotations

import pytest
from atlas_discovery_engine import BraveSearchProvider, SearchProvider, SearchResult

from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.source_fetcher import (
    _extract_page_text,
    _infer_source_type,
    _normalize_queries,
    _should_keep_source,
    build_search_provider,
    fetch_sources,
)


class TestSourceFetchingHelpers:
    """Tests for non-network source-fetching helpers."""

    def test_normalize_queries_accepts_strings_and_query_objects(self) -> None:
        """Mixed query inputs should normalize into plain strings."""
        queries = generate_queries("Kansas City", "MO", ["housing_affordability"])

        normalized = _normalize_queries([queries[0], "plain query"])

        assert normalized[0] == queries[0].query
        assert normalized[1] == "plain query"

    def test_should_keep_source_rejects_short_and_stale_content(self) -> None:
        """Low-value sources should be filtered out before extraction."""
        short_content = "too short"
        old_date = "2020-01-01"

        assert _should_keep_source(short_content, None) is False
        assert _should_keep_source("word " * 250, old_date) is False
        assert _should_keep_source("word " * 250, "2026-01-01") is True

    def test_should_keep_source_accepts_long_undated_content(self) -> None:
        """Long-form sources without a publication date should still be eligible."""
        assert _should_keep_source("word " * 250, None) is True

    def test_infer_source_type_uses_url_and_title(self) -> None:
        """Source type inference should detect common special cases."""
        assert (
            _infer_source_type("https://example.gov/notice", "Meeting Notice")
            == "government_record"
        )
        assert _infer_source_type("https://youtube.com/watch?v=1", "Video Interview") == "video"
        assert _infer_source_type("https://example.com/podcast/1", "Podcast Episode") == "podcast"
        assert _infer_source_type("https://instagram.com/example", "Profile") == "social_media"
        assert (
            _infer_source_type("https://example.org/community-calendar", "Mutual Aid Calendar")
            == "community_archive"
        )

    def test_build_search_provider_returns_brave_for_a_key(self) -> None:
        """A configured key yields a Brave-backed provider."""
        provider = build_search_provider("test-key")

        assert isinstance(provider, BraveSearchProvider)

    def test_build_search_provider_returns_none_without_a_key(self) -> None:
        """Missing search credentials yield no provider, skipping search."""
        assert build_search_provider(None) is None

    @pytest.mark.asyncio
    async def test_extract_page_text_uses_trafilatura(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """HTML responses should be passed through trafilatura extraction."""

        class FakeResponse:
            text = "<html><body><p>Readable text</p></body></html>"

            def raise_for_status(self) -> None:
                return None

        class FakeClient:
            async def get(self, _url: str) -> FakeResponse:
                return FakeResponse()

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.source_fetcher.trafilatura.extract",
            lambda text, **_kwargs: "Readable text" if "Readable" in text else "",
        )

        content = await _extract_page_text(FakeClient(), "https://example.com/story")

        assert content == "Readable text"

    @pytest.mark.asyncio
    async def test_fetch_sources_deduplicates_and_filters(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Fetching should deduplicate URLs and keep only useful extracted pages."""

        class FakeProvider(SearchProvider):
            async def search(self, _queries: object) -> list[SearchResult]:
                return [
                    SearchResult(
                        url="https://example.com/story",
                        title="Story",
                        publication="Example News",
                        published="2026-01-15",
                    ),
                    SearchResult(
                        url="https://example.com/story",
                        title="Story Duplicate",
                        publication="Example News",
                        published="2026-01-15",
                    ),
                    SearchResult(
                        url="https://example.com/short",
                        title="Short",
                        publication="Example News",
                        published="2026-01-15",
                    ),
                ]

        class FakeClient:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
                return None

        async def fake_extract(_client: object, url: str) -> str:
            if url.endswith("/short"):
                return "tiny"
            return "word " * 250

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.source_fetcher._extract_page_text", fake_extract
        )
        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.source_fetcher.httpx.AsyncClient", FakeClient
        )

        results = await fetch_sources(["housing"], FakeProvider())

        assert len(results) == 1
        assert results[0].url == "https://example.com/story"
        assert results[0].published_date == "2026-01-15"

    @pytest.mark.asyncio
    async def test_fetch_sources_survives_a_provider_with_no_results(self) -> None:
        """A search outage that empties results must not fail the whole run."""

        class EmptyProvider(SearchProvider):
            async def search(self, _queries: object) -> list[SearchResult]:
                return []

        assert await fetch_sources(["housing"], EmptyProvider()) == []

    @pytest.mark.asyncio
    async def test_fetch_sources_returns_empty_without_provider(self) -> None:
        """A missing provider should safely skip source fetching."""
        assert await fetch_sources(["housing"], None) == []

    @pytest.mark.asyncio
    async def test_fetch_sources_returns_empty_for_empty_queries(self) -> None:
        """An empty query list short-circuits without invoking search."""

        class UnusedProvider(SearchProvider):
            async def search(self, _queries: object) -> list[SearchResult]:
                pytest.fail("provider should not be called for empty queries")

        assert await fetch_sources([], UnusedProvider()) == []

    def test_infer_source_type_returns_report_for_pdf_or_report(self) -> None:
        """Reports and PDFs should be classified as report sources."""
        assert _infer_source_type("https://example.com/file.pdf", "Annual Report") == "report"
        assert _infer_source_type("https://example.com/x", "Quarterly Report") == "report"
