"""Tests for fetching org discovery runs."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.api_org import OrgDiscoveryRunResponse, get_org_discovery_run
from atlas.domains.discovery.models import DiscoveryRunCRUD
from tests.domains.discovery.api_org_support import ORG_ID, _make_actor


class TestGetOrgDiscoveryRun:
    """Tests for the get_org_discovery_run endpoint."""

    @pytest.mark.asyncio
    async def test_returns_owned_run(self, db: object) -> None:
        """Fetching a run owned by the org should return its details."""
        actor = _make_actor()
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        await OwnershipCRUD.create_ownership(
            db,
            resource_id=run_id,
            resource_type="discovery_run",
            org_id=ORG_ID,
            visibility="private",
            created_by="user_test_1",
        )

        result = await get_org_discovery_run(
            org_id=ORG_ID,
            run_id=run_id,
            response=None,
            actor=actor,
            db=db,
        )

        assert isinstance(result, OrgDiscoveryRunResponse)
        assert result.id == run_id
        assert result.org_id == ORG_ID

    @pytest.mark.asyncio
    async def test_returns_404_for_unowned_run(self, db: object) -> None:
        """Fetching a run not owned by the org should raise 404."""
        actor = _make_actor()
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_org_discovery_run(
                org_id=ORG_ID,
                run_id=run_id,
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_returns_404_for_wrong_org(self, db: object) -> None:
        """A run owned by another org should be invisible (404)."""
        actor = _make_actor()
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        await OwnershipCRUD.create_ownership(
            db,
            resource_id=run_id,
            resource_type="discovery_run",
            org_id="org_other",
            visibility="private",
            created_by="other_user",
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_org_discovery_run(
                org_id=ORG_ID,
                run_id=run_id,
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_org_mismatch_raises_403(self, db: object) -> None:
        """Accessing another org's endpoint should raise 403."""
        actor = _make_actor("org_other")

        with pytest.raises(HTTPException) as exc_info:
            await get_org_discovery_run(
                org_id=ORG_ID,
                run_id="any_id",
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.FORBIDDEN

    @pytest.mark.asyncio
    async def test_returns_404_when_run_deleted(self, db: object) -> None:
        """If an ownership record exists but the run itself is gone, return 404."""
        actor = _make_actor()
        run_id = "phantom_run_id"
        await OwnershipCRUD.create_ownership(
            db,
            resource_id=run_id,
            resource_type="discovery_run",
            org_id=ORG_ID,
            visibility="private",
            created_by="user_test_1",
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_org_discovery_run(
                org_id=ORG_ID,
                run_id=run_id,
                response=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.NOT_FOUND
