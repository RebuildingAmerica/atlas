"""Tests for the pipeline summary endpoint."""

from __future__ import annotations

import pytest

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD, DiscoveryScheduleCRUD


class TestPipelineSummaryEndpoint:
    @pytest.mark.asyncio
    async def test_summary_empty(self, test_db: object, actor) -> None:
        resp = await discovery_api.get_pipeline_summary(response=None, actor=actor, db=test_db)
        assert resp.queued_jobs == 0
        assert resp.running_jobs == 0
        assert resp.failed_jobs == 0
        assert resp.completed_runs_total == 0
        assert resp.enabled_schedules == 0

    @pytest.mark.asyncio
    async def test_summary_counts_schedules_and_jobs(self, test_db: object, actor) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.get_pipeline_summary(response=None, actor=actor, db=test_db)
        assert resp.queued_jobs == 1
        assert resp.enabled_schedules == 1

    @pytest.mark.asyncio
    async def test_summary_counts_past_the_list_cap(self, test_db: object, actor) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        queued_total = 55
        for _ in range(queued_total):
            await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.get_pipeline_summary(response=None, actor=actor, db=test_db)
        assert resp.queued_jobs == queued_total
