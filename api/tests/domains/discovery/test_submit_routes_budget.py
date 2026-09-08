"""Budget metering on the contribution and sync submit routes.

Both routes declared ``enforce_limit("research_runs_per_month")`` and then
never reserved against it, so a free-tier workspace capped at two runs a
month could create unlimited runs by going through Scout instead of the
in-app start button.
"""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException, Response

from atlas.domains.discovery.api_submit_routes import (
    _current_budget_month,
    contribute_discovery_results,
)
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from tests.domains.discovery.api_org_support import ORG_ID, _make_actor
from tests.domains.discovery.submit_routes_support import make_contribution_request


class TestContributionBudget:
    """The contribution route has to spend the same budget as a hosted run."""

    @pytest.mark.asyncio
    async def test_contribution_spends_the_monthly_budget(self, db: object) -> None:
        """A contributed run counts against the workspace's metered budget."""
        actor = _make_actor()
        month = _current_budget_month()
        await OrgDiscoveryBudgetCRUD.set_budget(
            db,
            org_id=ORG_ID,
            month=month,
            monthly_run_limit=2,
            used_runs=0,
        )

        await contribute_discovery_results(
            req=make_contribution_request(),
            response=Response(),
            actor=actor,
            db=db,
            _cap=None,
            _run_limit=2,
        )

        budget = await OrgDiscoveryBudgetCRUD.get_budget(db, org_id=ORG_ID, month=month)
        assert budget is not None
        assert budget.used_runs == 1

    @pytest.mark.asyncio
    async def test_contribution_stops_at_the_monthly_budget(self, db: object) -> None:
        """A spent budget refuses a contribution instead of ingesting it."""
        actor = _make_actor()
        month = _current_budget_month()
        await OrgDiscoveryBudgetCRUD.set_budget(
            db,
            org_id=ORG_ID,
            month=month,
            monthly_run_limit=1,
            used_runs=1,
        )

        with pytest.raises(HTTPException) as exc_info:
            await contribute_discovery_results(
                req=make_contribution_request(),
                response=Response(),
                actor=actor,
                db=db,
                _cap=None,
                _run_limit=1,
            )

        assert exc_info.value.status_code == HTTPStatus.CONFLICT

    @pytest.mark.asyncio
    async def test_unlimited_plan_skips_the_budget(self, db: object) -> None:
        """A plan with no run ceiling contributes without reserving."""
        actor = _make_actor()
        month = _current_budget_month()

        await contribute_discovery_results(
            req=make_contribution_request(),
            response=Response(),
            actor=actor,
            db=db,
            _cap=None,
            _run_limit=None,
        )

        budget = await OrgDiscoveryBudgetCRUD.get_budget(db, org_id=ORG_ID, month=month)
        assert budget is None or budget.used_runs == 0
