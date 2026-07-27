"""Tests for the discovery job queue endpoint."""

from __future__ import annotations

import pytest

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD


class TestPipelineJobQueueEndpoint:
    @pytest.mark.asyncio
    async def test_job_queue_lists_active_and_failed_jobs_with_worker_context(
        self, test_db: object, actor
    ) -> None:
        queued_run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Detroit, MI",
            state="MI",
            issue_areas=["housing_affordability"],
        )
        running_run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Phoenix, AZ",
            state="AZ",
            issue_areas=["worker_power"],
        )
        completed_run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Milwaukee, WI",
            state="WI",
            issue_areas=["democracy"],
        )
        queued_job_id = await DiscoveryJobCRUD.create(test_db, run_id=queued_run_id)
        running_job_id = await DiscoveryJobCRUD.create(test_db, run_id=running_run_id)
        completed_job_id = await DiscoveryJobCRUD.create(test_db, run_id=completed_run_id)
        await test_db.execute(
            """
            UPDATE discovery_jobs
            SET status = 'running',
                progress = ?,
                claimed_by = ?,
                claimed_until = ?,
                started_at = ?
            WHERE id = ?
            """,
            (
                '{"step":"fetching_sources","sources":12}',
                "worker-a",
                "2026-07-03T12:15:00+00:00",
                "2026-07-03T12:00:00+00:00",
                running_job_id,
            ),
        )
        await DiscoveryJobCRUD.complete(test_db, completed_job_id)
        await test_db.commit()

        resp = await discovery_api.list_discovery_job_queue(
            response=None,
            actor=actor,
            db=test_db,
            limit=10,
        )

        expected_visible_jobs = 2
        assert resp.total == expected_visible_jobs
        assert resp.status_counts == {
            "queued": 1,
            "running": 1,
            "claimed": 0,
            "failed": 0,
        }
        assert [item.id for item in resp.items] == [running_job_id, queued_job_id]
        running_item = resp.items[0]
        assert running_item.run_id == running_run_id
        assert running_item.location_query == "Phoenix, AZ"
        assert running_item.state == "AZ"
        assert running_item.issue_areas == ["worker_power"]
        assert running_item.status == "running"
        assert running_item.progress == {"step": "fetching_sources", "sources": 12}
        assert running_item.claimed_by == "worker-a"
        assert running_item.claimed_until == "2026-07-03T12:15:00+00:00"

    @pytest.mark.asyncio
    async def test_job_queue_respects_limit(self, test_db: object, actor) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.list_discovery_job_queue(
            response=None,
            actor=actor,
            db=test_db,
            limit=1,
        )

        expected_total_jobs = 2
        assert resp.total == expected_total_jobs
        assert len(resp.items) == 1
