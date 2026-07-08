"""Tests for the discovery job status endpoint."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD
from tests.domains.discovery.schedule_support import EXPECTED_NOT_FOUND


class TestJobStatusEndpoint:
    @pytest.mark.asyncio
    async def test_get_job(self, test_db: object, actor) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.get_discovery_job(
            job_id,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.id == job_id
        assert resp.status == "queued"

    @pytest.mark.asyncio
    async def test_get_job_not_found(self, test_db: object, actor) -> None:
        with pytest.raises(HTTPException) as exc_info:
            await discovery_api.get_discovery_job(
                "nonexistent",
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND
