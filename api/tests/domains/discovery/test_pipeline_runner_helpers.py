"""Discovery pipeline runner helper-path tests."""

from __future__ import annotations

import importlib
import importlib.util

import pytest
from atlas_discovery_engine import BraveSearchProvider
from atlas_shared import RawEntry

from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD

SEARCH_OFFLINE_ERROR = "search offline"
STRENGTHENED_SOURCE_COUNT = 2


def _load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")


class TestRunnerHelpers:
    """Tests for runner helper paths not covered by the main e2e case."""

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_routes_search_through_a_provider(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The runner should build a SearchProvider from its key and hand it to fetch_sources."""
        runner_module = _load_runner_module()
        captured: dict[str, object] = {}

        async def capturing_fetch_sources(
            queries: list[object],
            provider: object = None,
        ) -> list[FetchedSource]:
            assert queries
            captured["provider"] = provider
            return []

        monkeypatch.setattr(runner_module, "fetch_sources", capturing_fetch_sources)

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
            credentials=DiscoveryPipelineCredentials(search_api_key="test-search-key"),
        )

        assert isinstance(captured["provider"], BraveSearchProvider)

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
    async def test_run_discovery_pipeline_consolidates_repeated_domain_mentions(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A same-domain rediscovery should strengthen the known actor, not add clutter."""
        runner_module = _load_runner_module()
        existing_entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Neighborhood Tenant Clinic",
            description="Known tenant clinic.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            website="https://tenantclinic.org",
        )
        existing_source_id = await SourceCRUD.create(
            test_db,
            url="https://tenantclinic.org/about",
            source_type="org_website",
            extraction_method="manual",
            title="About Neighborhood Tenant Clinic",
        )
        await SourceCRUD.link_to_entry(
            test_db,
            existing_entry_id,
            existing_source_id,
            "Neighborhood Tenant Clinic describes its tenant legal support.",
        )
        await RelationshipCRUD.upsert_identity_key(
            test_db,
            entry_id=existing_entry_id,
            key_type="domain",
            key_value="tenantclinic.org",
            source_id=existing_source_id,
            confidence=0.95,
        )

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://news.example/tenant-clinic-profile",
                    title="Tenant Clinic Profile",
                    publication="Kansas City Civic News",
                    published_date="2026-02-01",
                    content="Tenant Clinic KC is cited for local tenant organizing.",
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
                    name="Tenant Clinic KC",
                    entry_type="organization",
                    description="Tenant Clinic KC supports renters facing displacement.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["housing_affordability"],
                    website="https://www.tenantclinic.org/",
                    extraction_context="Tenant Clinic KC is cited for local tenant organizing.",
                )
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

        results = await EntryCRUD.search_public(test_db, states=["MO"])
        assert results["total"] == 1
        assert results["entries"][0]["entry"].id == existing_entry_id
        assert results["entries"][0]["entry"].description == (
            "Tenant Clinic KC supports renters facing displacement."
        )
        assert results["entries"][0]["source_count"] == STRENGTHENED_SOURCE_COUNT

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
