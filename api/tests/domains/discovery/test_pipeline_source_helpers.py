"""Discovery source fetching and extraction helper tests."""

from __future__ import annotations

import importlib

import pytest
from atlas_discovery_engine import (
    BraveSearchProvider,
    SearchProvider,
    SearchResult,
    build_extraction_system_prompt,
    parse_extraction_response,
)

from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.source_fetcher import (
    _extract_page_text,
    _infer_source_type,
    _normalize_queries,
    _should_keep_source,
    build_search_provider,
    fetch_sources,
)

ANTHROPIC_OUTAGE_ERROR = "anthropic outage"
PASS_TWO_OUTAGE_ERROR = "pass2 outage"


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


class TestExtractionHelpers:
    """Tests for prompt and parsing helpers."""

    def testbuild_extraction_system_prompt_includes_location_and_taxonomy(self) -> None:
        """The extraction prompt should carry the target location and issue taxonomy."""
        prompt = build_extraction_system_prompt("Kansas City", "MO")

        assert "Kansas City, MO" in prompt
        assert "housing_affordability" in prompt
        assert "worker_cooperatives" in prompt

    def testparse_extraction_response_handles_fenced_json(self) -> None:
        """Claude JSON responses wrapped in Markdown fences should still parse."""
        payload = """
```json
[
  {
    "name": "Prairie Workers Cooperative",
    "type": "organization",
    "description": "Worker-owned cooperative.",
    "city": "Kansas City",
    "state": "MO",
    "geo_specificity": "local",
    "issue_areas": ["worker_cooperatives"],
    "website": "https://prairie.example",
    "email": "info@prairie.example",
    "extraction_context": "The cooperative now employs 45 people."
  }
]
```
"""
        parsed = parse_extraction_response(text=payload)

        assert len(parsed) == 1
        assert parsed[0].name == "Prairie Workers Cooperative"
        assert parsed[0].website == "https://prairie.example"
        assert parsed[0].email == "info@prairie.example"

    def testparse_extraction_response_accepts_object_wrapper(self) -> None:
        """Object-wrapped payloads should parse via the entries field."""
        payload = """
        {
          "entries": [
            {
              "name": "Wrapped Entry",
              "type": "organization",
              "description": "Wrapped.",
              "city": "Kansas City",
              "state": "MO",
              "geo_specificity": "local",
              "issue_areas": ["housing_affordability"]
            }
          ]
        }
        """
        parsed = parse_extraction_response(text=payload)

        assert len(parsed) == 1
        assert parsed[0].name == "Wrapped Entry"

    @pytest.mark.asyncio
    async def test_extract_entries_calls_anthropic_and_parses_text_blocks(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Extraction should call Anthropic with two passes and parse the returned JSON."""
        call_count = 0
        pass1_response = (
            '[{"name":"Kansas City Housing Coalition","type":"organization",'
            '"quote":"The Kansas City Housing Coalition works on affordability."}]'
        )
        pass2_response = (
            '{"entries":[{"name":"Kansas City Housing Coalition","type":"organization",'
            '"description":"Parsed from Claude.","city":"Kansas City",'
            '"state":"MO","geo_specificity":"local",'
            '"issue_areas":["housing_affordability"],'
            '"extraction_context":"The Kansas City Housing Coalition works on affordability."}],'
            '"discovery_leads":[]}'
        )

        class FakeMessages:
            async def create(self, **_kwargs: object) -> object:
                nonlocal call_count
                call_count += 1
                text = pass1_response if call_count == 1 else pass2_response
                return type(
                    "Response",
                    (),
                    {"content": [type("Block", (), {"type": "text", "text": text})()]},
                )()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = FakeMessages()

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        parsed = await importlib.import_module(
            "atlas.domains.discovery.pipeline.extractor"
        ).extract_entries(
            "https://example.com/story",
            "The Kansas City Housing Coalition works on affordability in Kansas City.",
            "Kansas City",
            "MO",
            "test-key",
        )

        assert len(parsed) == 1
        assert parsed[0].name == "Kansas City Housing Coalition"

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_without_api_key(self) -> None:
        """Missing Anthropic credentials should short-circuit before calling the API."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")
        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            api_key=None,
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_for_blank_content(self) -> None:
        """Empty source text should short-circuit before calling the API."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")
        result = await extractor.extract_entries(
            "https://example.com/story",
            "   ",
            "Kansas City",
            "MO",
            api_key="test-key",
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_when_pass_one_identifies_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If pass 1 returns no entities, pass 2 should not run and the result is empty."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")

        class FakeMessages:
            def __init__(self) -> None:
                self.calls = 0

            async def create(self, **_kwargs: object) -> object:
                self.calls += 1
                return type(
                    "Response",
                    (),
                    {"content": [type("Block", (), {"type": "text", "text": "[]"})()]},
                )()

        fake_messages = FakeMessages()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = fake_messages

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            "test-key",
        )
        assert result == []
        assert fake_messages.calls == 1

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_when_pass_one_keeps_failing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Repeated pass-1 errors should exhaust retries and yield an empty result."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")

        class FakeMessages:
            def __init__(self) -> None:
                self.calls = 0

            async def create(self, **_kwargs: object) -> object:
                self.calls += 1
                raise RuntimeError(ANTHROPIC_OUTAGE_ERROR)

        fake_messages = FakeMessages()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = fake_messages

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            "test-key",
        )
        assert result == []
        assert fake_messages.calls == 3  # noqa: PLR2004

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_when_pass_two_keeps_failing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If pass 2 raises every attempt, extraction should return an empty list."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")
        pass1_response = (
            '[{"name":"Kansas City Housing Coalition","type":"organization",'
            '"quote":"The Kansas City Housing Coalition works on affordability."}]'
        )

        class FakeMessages:
            def __init__(self) -> None:
                self.calls = 0

            async def create(self, **_kwargs: object) -> object:
                self.calls += 1
                if self.calls == 1:
                    return type(
                        "Response",
                        (),
                        {
                            "content": [
                                type("Block", (), {"type": "text", "text": pass1_response})()
                            ]
                        },
                    )()
                raise RuntimeError(PASS_TWO_OUTAGE_ERROR)

        fake_messages = FakeMessages()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = fake_messages

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            "test-key",
        )
        assert result == []
        assert fake_messages.calls == 4  # noqa: PLR2004
