"""Runner helper tests for existing entry behavior."""
# ruff: noqa

from __future__ import annotations

import pytest
from atlas_shared import DeduplicatedEntry as SharedDeduplicatedEntry
from atlas_shared import RawEntry

from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD

from tests.domains.discovery.pipeline_runner_support import (
    STRENGTHENED_SOURCE_COUNT,
    _load_runner_module,
)


class TestRunnerHelpersExistingEntry:
    """Runner helper tests for existing-entry paths."""

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
    async def test_find_existing_entry_returns_none_when_resolved_type_mismatches(
        self,
        test_db: object,
    ) -> None:
        """Domain matches should still fail closed when the resolved type differs."""
        runner_module = _load_runner_module()
        wrong_type_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="River City Mutual Aid",
            description="A person record used to cover type mismatch fallback.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            website="https://rivercityaid.org",
        )
        source_id = await SourceCRUD.create(
            test_db,
            url="https://rivercityaid.org/about",
            source_type="org_website",
            extraction_method="manual",
            title="About River City Mutual Aid",
        )
        await RelationshipCRUD.upsert_identity_key(
            test_db,
            entry_id=wrong_type_id,
            key_type="domain",
            key_value="rivercityaid.org",
            source_id=source_id,
            confidence=0.95,
        )

        entry = SharedDeduplicatedEntry(
            name="River City Mutual Aid",
            entry_type="organization",
            description="A matching domain should not absorb the wrong entity type.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            issue_areas=["housing_affordability"],
            website="https://rivercityaid.org",
            source_urls=["https://rivercityaid.org/about"],
        )

        assert await runner_module._find_existing_entry(test_db, entry) is None  # noqa: SLF001

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
