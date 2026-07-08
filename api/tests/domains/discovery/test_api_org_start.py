"""Tests for starting org discovery runs."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.api_org import (
    OrgDiscoveryRunResponse,
    OrgDiscoveryRunStartRequest,
    _current_budget_month,
    start_org_discovery_run,
)
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from tests.domains.discovery.api_org_support import ORG_ID, _make_actor


class TestStartOrgDiscoveryRun:
    """Tests for the start_org_discovery_run endpoint."""

    @pytest.mark.asyncio
    async def test_creates_run_with_ownership(self, db: object) -> None:
        """Starting a run should create both the run and an ownership record."""
        actor = _make_actor()
        req = OrgDiscoveryRunStartRequest(
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        result = await start_org_discovery_run(
            org_id=ORG_ID,
            req=req,
            response=None,
            actor=actor,
            db=db,
        )

        assert isinstance(result, OrgDiscoveryRunResponse)
        assert result.org_id == ORG_ID
        assert result.status == "running"
        assert result.location_query == "Kansas City, MO"

        ownership = await OwnershipCRUD.get_ownership(db, result.id, "discovery_run")
        assert ownership is not None
        assert ownership.org_id == ORG_ID
        assert ownership.visibility == "private"
        budget = await OrgDiscoveryBudgetCRUD.get_budget(
            db,
            org_id=ORG_ID,
            month=_current_budget_month(),
        )
        assert budget is not None
        assert budget.used_runs == 1

    @pytest.mark.asyncio
    async def test_monthly_budget_limit_blocks_new_run(self, db: object) -> None:
        """Tenant discovery runs should stop at the org's monthly metered budget."""
        actor = _make_actor()
        month = _current_budget_month()
        await OrgDiscoveryBudgetCRUD.set_budget(
            db,
            org_id=ORG_ID,
            month=month,
            monthly_run_limit=1,
            used_runs=1,
        )
        req = OrgDiscoveryRunStartRequest(
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        with pytest.raises(HTTPException) as exc_info:
            await start_org_discovery_run(
                org_id=ORG_ID,
                req=req,
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.CONFLICT
        assert exc_info.value.detail == {
            "org_id": ORG_ID,
            "month": month,
            "monthly_run_limit": 1,
            "used_runs": 1,
            "remaining_runs": 0,
        }

    @pytest.mark.asyncio
    async def test_unlimited_plan_skips_monthly_budget(self, db: object) -> None:
        """Team, Pro, and Research Pass run quotas should not spend org monthly budget."""
        actor = _make_actor()
        req = OrgDiscoveryRunStartRequest(
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        await start_org_discovery_run(
            org_id=ORG_ID,
            req=req,
            response=None,
            actor=actor,
            db=db,
            _run_limit=None,
        )

        budget = await OrgDiscoveryBudgetCRUD.get_budget(
            db,
            org_id=ORG_ID,
            month=_current_budget_month(),
        )
        assert budget is None

    @pytest.mark.asyncio
    async def test_invalid_issue_area_raises_400(self, db: object) -> None:
        """An invalid issue area slug should trigger a 400 error."""
        actor = _make_actor()
        req = OrgDiscoveryRunStartRequest(
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["totally_fake_issue_area"],
        )

        with pytest.raises(HTTPException) as exc_info:
            await start_org_discovery_run(
                org_id=ORG_ID,
                req=req,
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST
        assert "Invalid issue area" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_org_mismatch_raises_403(self, db: object) -> None:
        """Creating a run for a different org should raise 403."""
        actor = _make_actor("org_other")
        req = OrgDiscoveryRunStartRequest(
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        with pytest.raises(HTTPException) as exc_info:
            await start_org_discovery_run(
                org_id=ORG_ID,
                req=req,
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
