"""Runner helper tests for search and failure paths."""
# ruff: noqa

from __future__ import annotations

import pytest
from atlas_discovery_engine import BraveSearchProvider

from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
from atlas.models import DiscoveryRunCRUD

from tests.domains.discovery.pipeline_runner_support import (
    SEARCH_OFFLINE_ERROR,
    _load_runner_module,
)


class TestRunnerHelpers:
    """Tests for runner helper paths not covered by the main e2e case."""

    @pytest.mark.asyncio
    async def test_research_lead_confidence_returns_unverified_for_zero_sources(self) -> None:
        """A lead with no sources should stay explicitly unverified."""
        runner_module = _load_runner_module()

        assert runner_module._research_lead_confidence(0) == "unverified"  # noqa: SLF001

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
