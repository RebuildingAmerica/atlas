"""Pipeline behavior tests."""

from __future__ import annotations

import importlib
import importlib.util

import httpx
import pytest
from atlas_discovery_engine import (
    build_extraction_system_prompt,
    parse_extraction_response,
)
from atlas_shared import RawEntry
from hypothesis import given

from atlas.domains.discovery.pipeline.deduplicator import deduplicate_entries
from atlas.domains.discovery.pipeline.gap_analyzer import analyze_gaps
from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.ranker import rank_entries
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import (
    FetchedSource,
    _extract_page_text,
    _infer_source_type,
    _normalize_queries,
    _parse_result_age,
    _search_brave,
    _should_keep_source,
    fetch_sources,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.config import Settings
from tests.support.hypothesis_strategies import (
    city_names,
    issue_area_slugs,
    state_abbreviations,
)

EXPECTED_TWO_RECORDS = 2
EXPECTED_ACCEPTED_STATUS = 202
EXPECTED_TWO_ENTRIES = 2
SEARCH_OFFLINE_ERROR = "search offline"
ANTHROPIC_OUTAGE_ERROR = "anthropic outage"
PASS_TWO_OUTAGE_ERROR = "pass2 outage"


def _load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")


class TestQueryGeneration:
    """Tests for enriched query generation."""

    def test_generate_queries_expands_local_context(self) -> None:
        """Query generation should include location-specific outlets when configured."""
        queries = generate_queries(
            city="Kansas City",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        query_texts = {query.query for query in queries}
        assert any("Kansas City Star" in query for query in query_texts)
        assert any("KCUR" in query for query in query_texts)


@given(city_names(), state_abbreviations(), issue_area_slugs())
def test_generate_queries_emits_normalized_location_aware_queries(
    city: str,
    state: str,
    issue_area_slug: str,
) -> None:
    """Discovery query generation should stay deterministic and location-aware."""
    queries = generate_queries(city=city, state=state, issue_areas=[issue_area_slug])

    assert queries
    assert all(query.issue_area == issue_area_slug for query in queries)
    assert all(query.query == " ".join(query.query.split()) for query in queries)
    assert all(query.query for query in queries)
    assert all(f"{city}, {state}" in query.query for query in queries)


class TestDeduplication:
    """Tests for deduplication logic."""

    def test_deduplicate_entries_merges_exact_matches_and_unions_fields(self) -> None:
        """Exact same local org found twice should merge into one richer entry."""
        extracted = [
            {
                "name": "Prairie Workers Cooperative",
                "entry_type": "organization",
                "description": "Worker-owned cooperative in Garden City.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "website": "https://prairie.example",
                "email": None,
                "social_media": None,
                "affiliated_org": None,
                "source_urls": ["https://example.com/story-1"],
                "source_dates": ["2026-01-10"],
            },
            {
                "name": "Prairie Workers Cooperative",
                "entry_type": "organization",
                "description": "Worker-owned cooperative employing 45 people after layoffs.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["automation_and_ai_displacement", "worker_cooperatives"],
                "website": "https://prairie.example",
                "email": "info@prairie.example",
                "social_media": {"instagram": "prairiecoop"},
                "affiliated_org": None,
                "source_urls": ["https://example.com/story-2"],
                "source_dates": ["2026-01-15"],
            },
        ]

        result = deduplicate_entries(extracted)

        assert len(result.entries) == 1
        merged = result.entries[0]
        assert merged["email"] == "info@prairie.example"
        assert merged["description"] == extracted[1]["description"]
        assert set(merged["issue_areas"]) == {
            "worker_cooperatives",
            "automation_and_ai_displacement",
        }
        assert set(merged["source_urls"]) == {
            "https://example.com/story-1",
            "https://example.com/story-2",
        }
        assert merged["last_seen"] == "2026-01-15"

    def test_deduplicate_entries_flags_fuzzy_same_city_matches(self) -> None:
        """Fuzzy same-city name matches should be surfaced for review."""
        extracted = [
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "description": "Organizer.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
            {
                "name": "Maria Gonzales",
                "entry_type": "person",
                "description": "Co-op founder.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
        ]

        result = deduplicate_entries(extracted)

        assert len(result.flags) == 1
        assert result.flags[0].entry_indices == [0, 1]

    def test_deduplicate_entries_merges_with_existing_records(self) -> None:
        """Incoming extracted entries should merge into exact existing matches."""
        result = deduplicate_entries(
            [
                {
                    "name": "Existing Org",
                    "entry_type": "organization",
                    "description": "Newer description.",
                    "city": "Kansas City",
                    "state": "MO",
                    "geo_specificity": "local",
                    "issue_areas": ["housing_affordability"],
                    "source_urls": ["https://example.com/new"],
                    "source_dates": ["2026-01-15"],
                }
            ],
            existing=[
                {
                    "id": "existing-id",
                    "name": "Existing Org",
                    "entry_type": "organization",
                    "description": "Older description.",
                    "city": "Kansas City",
                    "state": "MO",
                    "geo_specificity": "local",
                    "issue_areas": ["worker_cooperatives"],
                    "source_urls": ["https://example.com/old"],
                    "source_dates": ["2026-01-10"],
                }
            ],
        )

        assert len(result.entries) == 1
        assert result.entries[0]["name"] == "Existing Org"
        assert set(result.entries[0]["source_urls"]) == {
            "https://example.com/new",
            "https://example.com/old",
        }

    def test_deduplicate_entries_can_flag_one_candidate_then_merge_another(self) -> None:
        """Deduplication should keep scanning after a flag so a later exact match can merge."""
        extracted = [
            {
                "name": "Maria Gonzales",
                "entry_type": "person",
                "description": "Kansas City organizer.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "description": "Wichita organizer.",
                "city": "Wichita",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "description": "Kansas City co-op founder.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
        ]

        result = deduplicate_entries(extracted)

        assert result.merges == [[1, 2]]
        assert len(result.flags) == 1
        assert result.flags[0].entry_indices == [0, 2]
        assert len(result.entries) == EXPECTED_TWO_ENTRIES


class TestRanking:
    """Tests for ranking behavior."""

    def test_rank_entries_prefers_density_recency_and_contact_surface(self) -> None:
        """Ranking should prefer stronger, more reachable, more recent entries."""
        entries = [
            {
                "id": "best",
                "name": "Best Entry",
                "geo_specificity": "local",
                "description": (
                    "Detailed local organization building affordable housing with clear "
                    "programs and public contact channels."
                ),
                "website": "https://best.example",
                "email": "contact@best.example",
                "last_seen": "2026-02-01",
            },
            {
                "id": "weaker",
                "name": "Weaker Entry",
                "geo_specificity": "statewide",
                "description": "Advocacy group.",
                "website": None,
                "email": None,
                "last_seen": "2025-01-01",
            },
        ]

        ranked = rank_entries(entries, source_counts={"best": 3, "weaker": 1})

        assert ranked[0].entry["id"] == "best"
        assert ranked[0].score > ranked[1].score
        assert ranked[0].components["source_density"] > ranked[1].components["source_density"]


class TestGapAnalysis:
    """Tests for discovery coverage-gap analysis."""

    def test_analyze_gaps_marks_covered_issues_and_ignores_entries_without_issue_areas(
        self,
    ) -> None:
        """Gap analysis should ignore malformed entries and distinguish covered vs thin issues."""
        report = analyze_gaps(
            "Kansas City, MO",
            [
                {"name": "Malformed atlas entry"},
                {"issue_areas": ["housing_affordability"]},
                {"issue_areas": ["housing_affordability", "worker_cooperatives"]},
                {"issue_areas": ["housing_affordability"]},
            ],
        )

        assert "housing_affordability" in report.covered_issues
        assert "worker_cooperatives" in report.thin_issues


class TestDiscoveryRunner:
    """Tests for end-to-end discovery execution."""

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_persists_source_linked_results(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A run should fetch, extract, deduplicate, persist, and complete."""
        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/story-1",
                    title="Story One",
                    publication="Kansas City Star",
                    published_date="2026-01-10",
                    content="Story one content",
                    source_type="news_article",
                ),
                FetchedSource(
                    url="https://example.com/story-2",
                    title="Story Two",
                    publication="KCUR",
                    published_date="2026-01-15",
                    content="Story two content",
                    source_type="news_article",
                ),
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Prairie Workers Cooperative",
                    entry_type="organization",
                    description="Worker-owned cooperative employing 45 people after layoffs.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["worker_cooperatives", "housing_affordability"],
                    website="https://prairie.example",
                    email="info@prairie.example",
                    extraction_context="Prairie Workers Cooperative now employs 45 people.",
                )
            ]

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["worker_cooperatives", "housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["worker_cooperatives", "housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.queries_generated > 0
        assert run.sources_fetched == EXPECTED_TWO_RECORDS
        assert run.sources_processed == EXPECTED_TWO_RECORDS
        assert run.entries_extracted == EXPECTED_TWO_RECORDS
        assert run.entries_after_dedup == 1

        # The trust gate holds an uncorroborated web-only org: it is persisted with
        # its sources but stays out of public search until a curator approves it.
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        public_results = await EntryCRUD.search_public(test_db, states=["MO"])
        assert public_results["total"] == 0

        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert len(pending) == 1
        assert pending[0].hold_reason == "uncorroborated_web_only"

        held_entry, sources = await EntryCRUD.get_with_sources(test_db, pending[0].entity_id)
        assert held_entry is not None
        assert held_entry.name == "Prairie Workers Cooperative"
        assert held_entry.active is False
        assert len(sources) == EXPECTED_TWO_RECORDS


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

    def test_parse_result_age_only_accepts_iso_dates(self) -> None:
        """Search ages should normalize only when already ISO-like."""
        assert _parse_result_age("2026-01-15") == "2026-01-15"
        assert _parse_result_age("3 days ago") is None
        assert _parse_result_age(None) is None

    @pytest.mark.asyncio
    async def test_search_brave_transforms_results(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Brave search results should map into the fetcher's metadata shape."""

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict[str, object]:
                return {
                    "web": {
                        "results": [
                            {
                                "url": "https://example.com/story",
                                "title": "Story",
                                "profile": {"name": "Example News"},
                                "age": "2026-01-15",
                            }
                        ]
                    }
                }

        class FakeClient:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
                return None

            async def get(self, _url: str, **_kwargs: object) -> FakeResponse:
                return FakeResponse()

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.source_fetcher.httpx.AsyncClient", FakeClient
        )

        results = await _search_brave(["housing"], "test-key")

        assert results == [
            {
                "url": "https://example.com/story",
                "title": "Story",
                "publication": "Example News",
                "age": "2026-01-15",
            }
        ]

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

        async def fake_search(_queries: list[str], _api_key: str) -> list[dict[str, str | None]]:
            return [
                {
                    "url": "https://example.com/story",
                    "title": "Story",
                    "publication": "Example News",
                    "age": "2026-01-15",
                },
                {
                    "url": "https://example.com/story",
                    "title": "Story Duplicate",
                    "publication": "Example News",
                    "age": "2026-01-15",
                },
                {
                    "url": "https://example.com/short",
                    "title": "Short",
                    "publication": "Example News",
                    "age": "2026-01-15",
                },
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
            "atlas.domains.discovery.pipeline.source_fetcher._search_brave", fake_search
        )
        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.source_fetcher._extract_page_text", fake_extract
        )
        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.source_fetcher.httpx.AsyncClient", FakeClient
        )

        results = await fetch_sources(["housing"], "test-key")

        assert len(results) == 1
        assert results[0].url == "https://example.com/story"

    @pytest.mark.asyncio
    async def test_fetch_sources_returns_empty_without_api_key(self) -> None:
        """Missing search credentials should safely skip source fetching."""
        assert await fetch_sources(["housing"], None) == []

    @pytest.mark.asyncio
    async def test_fetch_sources_returns_empty_for_empty_queries(self) -> None:
        """An empty query list short-circuits without invoking search."""
        assert await fetch_sources([], "any-key") == []

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
        # Only pass 1 should have been called.
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
        # Pass 1 should retry up to _MAX_ATTEMPTS (3) before giving up.
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
        # Pass 1 succeeded once; pass 2 retried up to _MAX_ATTEMPTS (3).
        assert fake_messages.calls == 4  # noqa: PLR2004


class TestDiscoveryApiIntegration:
    """Tests for API-triggered discovery execution."""

    @pytest.mark.asyncio
    async def test_start_discovery_run_can_execute_inline(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Inline mode should run the pipeline before returning the response."""
        from atlas.main import create_app
        from atlas.platform.config import get_settings

        async def fake_runner(**_kwargs: object) -> None:
            job = _kwargs["job"]
            conn = await _get_db_connection(db_url)
            try:
                run = await DiscoveryRunCRUD.get_by_id(conn, job.run_id)
                assert run is not None
                entry_id = await EntryCRUD.create(
                    conn,
                    entry_type="organization",
                    name="Inline Discovery Result",
                    description="Created during inline execution.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                )
                await conn.execute(
                    """
                    INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
                    VALUES (?, ?, datetime('now'))
                    """,
                    (entry_id, "housing_affordability"),
                )
                await conn.commit()
                await DiscoveryRunCRUD.complete(
                    conn, job.run_id, queries_generated=1, entries_confirmed=1
                )
            finally:
                await conn.close()

        monkeypatch.setattr(
            "atlas.domains.discovery.api.run_discovery_pipeline_for_run", fake_runner
        )

        settings = Settings(
            database_url=db_url,
            anthropic_api_key="test-key",
            search_api_key="test-search",
            discovery_inline=True,
            deploy_mode="local",
        )
        app = create_app()
        app.dependency_overrides[get_settings] = lambda: settings

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/discovery-runs",
                json={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
            )

        assert response.status_code == EXPECTED_ACCEPTED_STATUS
        data = response.json()
        assert data["status"] == "completed"
        assert data["entries_confirmed"] == 1


class TestRunnerHelpers:
    """Tests for runner helper paths not covered by the main e2e case."""

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_marks_runs_failed_when_fetching_raises(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Operational pipeline failures should mark the run as failed before re-raising."""
        runner_module = _load_runner_module()

        async def failing_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            raise RuntimeError(SEARCH_OFFLINE_ERROR)

        monkeypatch.setattr(runner_module, "fetch_sources", failing_fetch_sources)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["worker_cooperatives"],
        )

        with pytest.raises(RuntimeError, match=SEARCH_OFFLINE_ERROR):
            await runner_module.run_discovery_pipeline(
                test_db,
                job=DiscoveryPipelineJob(
                    run_id=run_id,
                    location_query="Kansas City, MO",
                    state="MO",
                    issue_areas=["worker_cooperatives"],
                ),
                credentials=DiscoveryPipelineCredentials(search_api_key="test-search-key"),
            )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert run.error_message == SEARCH_OFFLINE_ERROR

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_updates_existing_entry(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Existing exact matches should be updated instead of duplicated."""
        runner_module = _load_runner_module()
        existing_entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Prairie Workers Cooperative",
            description="Old description.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/story-3",
                    title="Story Three",
                    publication="KCUR",
                    published_date="2026-02-01",
                    content="Story three content",
                    source_type="news_article",
                )
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Prairie Workers Cooperative",
                    entry_type="organization",
                    description="Updated description from new source.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["worker_cooperatives"],
                    extraction_context="Updated description from new source.",
                )
            ]

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["worker_cooperatives"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["worker_cooperatives"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        results = await EntryCRUD.search_public(test_db, states=["MO"])
        assert results["total"] == 1
        assert results["entries"][0]["entry"].id == existing_entry_id
        assert results["entries"][0]["entry"].description == "Updated description from new source."

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_skips_confirmed_entries_missing_on_reload(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Runs should complete even if a freshly upserted entry cannot be reloaded for reporting."""
        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/story-missing",
                    title="Story Missing",
                    publication="KCUR",
                    published_date="2026-02-01",
                    content="Story content",
                    source_type="news_article",
                )
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Prairie Housing Alliance",
                    entry_type="organization",
                    description="New housing organization discovered for Atlas.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["housing_affordability"],
                    extraction_context="Prairie Housing Alliance was recently launched.",
                )
            ]

        async def missing_entry(_conn: object, _entry_id: str) -> None:
            return None

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)
        monkeypatch.setattr(runner_module.EntryCRUD, "get_by_id", missing_entry)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.entries_confirmed == 0

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_updates_existing_source_record(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When a fetched URL already has a source row, the runner should update it in place."""
        runner_module = _load_runner_module()
        from atlas.models import SourceCRUD

        # Pre-create a source row that the pipeline will rediscover.
        existing_source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/story-existing",
            source_type="news_article",
            extraction_method="manual",
            title="Old Title",
        )

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/story-existing",
                    title="Refreshed Title",
                    publication="KCUR",
                    published_date="2026-02-01",
                    content="Story content for an existing source",
                    source_type="news_article",
                )
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Story Existing Org",
                    entry_type="organization",
                    description="Discovered through an already-known source.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["worker_cooperatives"],
                    extraction_context="Story Existing Org appeared in this article.",
                )
            ]

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["worker_cooperatives"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["worker_cooperatives"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        refreshed = await SourceCRUD.get_by_id(test_db, existing_source_id)
        assert refreshed is not None
        assert refreshed.title == "Refreshed Title"
        assert refreshed.publication == "KCUR"

    @pytest.mark.asyncio
    async def test_persist_discovery_results_with_failed_status_uses_update_path(
        self,
        test_db: object,
    ) -> None:
        """When the supplied stats status is not COMPLETED, persist should record via update."""
        from atlas_shared import (
            DeduplicatedEntry as SharedDeduplicatedEntry,
        )
        from atlas_shared import (
            DiscoveryRunStats,
            DiscoveryRunStatus,
        )
        from atlas_shared import (
            RankedEntry as SharedRankedEntry,
        )

        runner_module = _load_runner_module()

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        ranked_entry = SharedRankedEntry(
            entry=SharedDeduplicatedEntry(
                name="Failed Run Org",
                entry_type="organization",
                description="Persisted despite a failed run status.",
                city="Kansas City",
                state="MO",
                geo_specificity="local",
                issue_areas=["housing_affordability"],
                source_urls=[],
            ),
            score=0.5,
        )
        stats = DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=0,
            sources_processed=0,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
            status=DiscoveryRunStatus.FAILED,
            error_message="search offline",
        )

        confirmed_ids, _sources = await runner_module.persist_discovery_results(
            test_db,
            run_id=run_id,
            ranked_entries=[ranked_entry],
            sources=[],
            stats=stats,
        )

        assert len(confirmed_ids) == 1
        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert run.error_message == "search offline"

    def test_build_page_task_outcomes_skips_entries_without_source_urls(self) -> None:
        """Raw entries lacking a list-shaped source_urls field should be skipped cleanly."""
        from atlas_shared import PageContent, SourceType

        runner_module = _load_runner_module()
        sources = [
            PageContent(
                url="https://example.com/page-a",
                source_type=SourceType.NEWS_ARTICLE,
            )
        ]
        outcomes = runner_module._build_page_task_outcomes(  # noqa: SLF001
            sources,
            raw_entries=[
                {"name": "no source urls"},
                {"name": "wrong shape", "source_urls": "not-a-list"},
                {"name": "good", "source_urls": ["https://example.com/page-a"]},
            ],
        )
        assert len(outcomes) == 1
        assert outcomes[0].entries_extracted == 1

    def test_raw_entry_to_shared_handles_missing_source_metadata(self) -> None:
        """Raw entries with no source dates / contexts should still convert cleanly."""
        runner_module = _load_runner_module()
        shared = runner_module._raw_entry_to_shared(  # noqa: SLF001
            {
                "name": "Bare Entry",
                "entry_type": "organization",
                "description": "No source metadata at all.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
            }
        )
        assert shared.name == "Bare Entry"
        assert shared.source_url == ""
        assert shared.source_date is None
        assert shared.extraction_context == ""

    def test_raw_entry_to_shared_skips_extraction_context_for_non_dict_payload(self) -> None:
        """A non-dict source_contexts value should not contribute an extraction_context."""
        runner_module = _load_runner_module()
        shared = runner_module._raw_entry_to_shared(  # noqa: SLF001
            {
                "name": "Quirky Entry",
                "entry_type": "organization",
                "description": "Has a URL but malformed contexts.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
                "source_urls": ["https://example.com/story"],
                "source_contexts": "should-have-been-a-dict",
            }
        )
        assert shared.source_url == "https://example.com/story"
        assert shared.extraction_context == ""


def _make_deduped_entry(
    *,
    entry_type: str,
    name: str,
    city: str,
    state: str,
) -> object:
    """Build a minimal shared deduplicated entry for trust-gate tests."""
    from atlas_shared import DeduplicatedEntry as SharedDeduplicatedEntry

    return SharedDeduplicatedEntry(
        name=name,
        entry_type=entry_type,
        description=f"{name} works on local issues.",
        city=city,
        state=state,
        geo_specificity="local",
        issue_areas=["housing_affordability"],
        source_urls=[],
    )


class TestTrustGateUpsert:
    """The upsert path must hold risky discoveries instead of publishing them."""

    @pytest.mark.asyncio
    async def test_discovered_person_is_held_not_published(self, test_db: object) -> None:
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()
        entry = _make_deduped_entry(
            entry_type="person", name="Sam Organizer", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert stored is not None
        assert stored.active is False
        assert [item.entity_id for item in pending] == [entity_id]
        assert pending[0].hold_reason == "person_requires_review"

    @pytest.mark.asyncio
    async def test_uncorroborated_org_is_held_not_published(self, test_db: object) -> None:
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()
        entry = _make_deduped_entry(
            entry_type="organization", name="Held Collective", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert stored is not None
        assert stored.active is False
        assert [item.entity_id for item in pending] == [entity_id]
        assert pending[0].hold_reason == "uncorroborated_web_only"

    @pytest.mark.asyncio
    async def test_publish_decision_creates_active_entry_without_queueing(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When the gate clears a new record, it is published and never enqueued."""
        from atlas.domains.discovery import trust_gate
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()

        def fake_evaluate(**_kwargs: object) -> trust_gate.GateDecision:
            return trust_gate.GateDecision(publish=True, hold_reason=None)

        monkeypatch.setattr(runner_module, "evaluate_publication", fake_evaluate)
        entry = _make_deduped_entry(
            entry_type="organization", name="Cleared Org", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert stored is not None
        assert stored.active is True
        assert pending == []

    @pytest.mark.asyncio
    async def test_dedup_flagged_discovery_is_held_as_suspect(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A dedup-flagged record is held with the dedup reason and the flag note."""
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/collective",
                    title="Collective",
                    publication="KCUR",
                    published_date="2026-02-01",
                    content="Collective content",
                    source_type="news_article",
                )
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Prairie Collective",
                    entry_type="organization",
                    description="A collective in Kansas City.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["housing_affordability"],
                    extraction_context="A collective in Kansas City.",
                ),
                RawEntry(
                    name="Prairie Collective",
                    entry_type="organization",
                    description="A collective in Springfield.",
                    city="Springfield",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["housing_affordability"],
                    extraction_context="A collective in Springfield.",
                ),
            ]

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        pending = await ReviewQueueCRUD.list_pending(test_db)
        suspect = next(item for item in pending if item.dedup_suspect)
        assert suspect.hold_reason == "dedup_suspect"
        assert suspect.dedup_note == "similar_name_same_city"

    @pytest.mark.asyncio
    async def test_already_active_match_is_not_unpublished(self, test_db: object) -> None:
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()
        existing_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Live Org",
            description="Already published.",
            city="KC",
            state="MO",
            geo_specificity="local",
        )
        entry = _make_deduped_entry(
            entry_type="organization", name="Live Org", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert entity_id == existing_id
        assert stored is not None
        assert stored.active is True
        assert pending == []


async def _get_db_connection(database_url: str) -> object:
    """Import lazily to avoid cluttering the top-level test dependencies."""
    from atlas.models import get_db_connection

    return await get_db_connection(database_url)
