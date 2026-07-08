"""Tests for the discovery run cancellation endpoint."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD
from tests.domains.discovery.schedule_support import EXPECTED_NOT_FOUND


class TestCancelRunEndpoint:
    @pytest.mark.asyncio
    async def test_cancel_run_cancels_jobs(self, test_db: object, actor) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.cancel_discovery_run(
            run_id,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.run_id == run_id
        assert resp.jobs_cancelled == 1
        job = await DiscoveryJobCRUD.get_by_run_id(test_db, run_id)
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_run_not_found(self, test_db: object, actor) -> None:
        with pytest.raises(HTTPException) as exc_info:
            await discovery_api.cancel_discovery_run(
                "nonexistent",
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_cancel_run_with_no_active_jobs_returns_zero(
        self, test_db: object, actor
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await DiscoveryJobCRUD.complete(test_db, job_id)

        resp = await discovery_api.cancel_discovery_run(
            run_id,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.jobs_cancelled == 0
