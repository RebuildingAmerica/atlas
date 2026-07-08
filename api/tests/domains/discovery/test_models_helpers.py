"""Tests for discovery model branch helpers."""

from __future__ import annotations

import pytest

from atlas.domains.discovery import models as discovery_models
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryRunCRUD,
    DiscoveryScheduleCRUD,
)


class TestDiscoveryCRUDBranchHelpers:
    @pytest.mark.asyncio
    async def test_run_list_returns_empty_when_no_rows(self, test_db: object) -> None:
        """Discovery run listing should fail closed on an empty table."""
        assert await DiscoveryRunCRUD.list(test_db) == []

    @pytest.mark.asyncio
    async def test_schedule_helpers_cover_missing_and_boolean_paths(self, test_db: object) -> None:
        """Schedule helpers should handle missing rows and explicit boolean updates."""
        assert await DiscoveryScheduleCRUD.get_by_id(test_db, "missing") is None

        schedule_id = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        disabled_id = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Dallas, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryScheduleCRUD.update(test_db, disabled_id, enabled=False)

        all_schedules = await DiscoveryScheduleCRUD.list(test_db)
        enabled_schedules = await DiscoveryScheduleCRUD.list(test_db, enabled_only=True)
        assert {schedule.id for schedule in all_schedules} == {schedule_id, disabled_id}
        assert [schedule.id for schedule in enabled_schedules] == [schedule_id]

        assert await DiscoveryScheduleCRUD.update(
            test_db,
            schedule_id,
            issue_areas=["worker_cooperatives"],
            enabled=False,
        )
        schedule = await DiscoveryScheduleCRUD.get_by_id(test_db, schedule_id)
        assert schedule is not None
        assert schedule.issue_areas == ["worker_cooperatives"]
        assert schedule.enabled is False
        assert await DiscoveryScheduleCRUD.delete(test_db, schedule_id)
        assert await DiscoveryScheduleCRUD.delete(test_db, "missing") is False

    @pytest.mark.asyncio
    async def test_job_helpers_cover_missing_rows_and_queue_items(self, test_db: object) -> None:
        """Job helpers should cover missing lookups, direct-url claims, and queue rows."""
        assert await DiscoveryJobCRUD.get_by_id(test_db, "missing") is None
        assert await DiscoveryJobCRUD.get_by_run_id(test_db, "missing-run") is None
        assert await DiscoveryJobCRUD.list_by_status(test_db, "queued") == []
        assert await DiscoveryJobCRUD.fail(test_db, "missing-job", "boom") is False

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db,
            run_id=run_id,
            job_input=discovery_models.DiscoveryJobInput(
                execution_mode="direct_url",
                payload={"direct_urls": ["https://example.test/seed"]},
            ),
        )
        job = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
        assert job is not None
        assert job.execution_mode == "direct_url"
        assert await DiscoveryJobCRUD.get_by_run_id(test_db, run_id) is not None

        claimed = await DiscoveryJobCRUD.claim_next(
            test_db,
            claimed_by="worker-1",
            search_key_configured=False,
        )
        assert claimed is not None
        assert claimed.id == job_id
        assert await DiscoveryJobCRUD.release_worker_leases(test_db, "worker-1") == 1
        released = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
        assert released is not None
        assert released.status == "queued"

        queue = await DiscoveryJobCRUD.list_queue(test_db)
        assert queue
        assert queue[0].id == job_id
        assert queue[0].input_payload == {"direct_urls": ["https://example.test/seed"]}

    @pytest.mark.asyncio
    async def test_claim_next_can_opt_into_search_key_restrictions(self, test_db: object) -> None:
        """Direct-url jobs should remain claimable even without search credentials."""
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db,
            run_id=run_id,
            job_input=discovery_models.DiscoveryJobInput(
                execution_mode="direct_url",
                payload={"direct_urls": ["https://example.test/seed"]},
            ),
        )

        claimed = await DiscoveryJobCRUD.claim_next(
            test_db,
            claimed_by="worker-2",
            search_key_configured=False,
        )

        assert claimed is not None
        assert claimed.id == job_id


class TestDiscoveryJobCRUDCountByStatus:
    @pytest.mark.asyncio
    async def test_count_by_status_aggregates_all_statuses(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        queued_total = 55
        for _ in range(queued_total):
            await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        failed_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await test_db.execute(  # type: ignore[attr-defined]
            "UPDATE discovery_jobs SET status = 'failed' WHERE id = ?", (failed_id,)
        )
        await test_db.commit()  # type: ignore[attr-defined]

        counts = await DiscoveryJobCRUD.count_by_status(test_db)

        assert counts["queued"] == queued_total
        assert counts["failed"] == 1

    @pytest.mark.asyncio
    async def test_count_by_status_is_empty_with_no_jobs(self, test_db: object) -> None:
        counts = await DiscoveryJobCRUD.count_by_status(test_db)
        assert counts == {}
