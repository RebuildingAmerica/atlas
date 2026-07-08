"""Runner helper tests for source updates."""

from __future__ import annotations

import pytest
from atlas_shared import RawEntry

from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
from atlas.models import DiscoveryRunCRUD, SourceCRUD
from tests.domains.discovery.pipeline_runner_support import _load_runner_module


class TestRunnerHelpersSource:
    """Runner helper tests for source persistence."""

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_updates_existing_source_record(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When a fetched URL already has a source row, the runner should update it in place."""
        runner_module = _load_runner_module()

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
