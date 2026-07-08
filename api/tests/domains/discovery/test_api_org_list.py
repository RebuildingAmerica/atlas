"""Tests for listing org discovery runs."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.api_org import (
    OrgDiscoveryRunCollectionResponse,
    list_org_discovery_runs,
)
from atlas.domains.discovery.models import DiscoveryRunCRUD
from tests.domains.discovery.api_org_support import ORG_ID, _make_actor


class TestListOrgDiscoveryRuns:
    """Tests for the list_org_discovery_runs endpoint."""

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_runs(self, db: object) -> None:
        """An org with no discovery runs should get an empty collection."""
        actor = _make_actor()
        result = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status=None,
            limit=50,
            cursor=None,
            actor=actor,
            db=db,
        )

        assert isinstance(result, OrgDiscoveryRunCollectionResponse)
        assert result.items == []
        assert result.total == 0
        assert result.next_cursor is None

    @pytest.mark.asyncio
    async def test_returns_owned_runs(self, db: object) -> None:
        """Only runs owned by the org should be returned."""
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

        result = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status=None,
            limit=50,
            cursor=None,
            actor=actor,
            db=db,
        )

        assert result.total == 1
        assert result.items[0].id == run_id

    @pytest.mark.asyncio
    async def test_skips_ownership_pointing_to_missing_run(self, db: object) -> None:
        """An ownership row whose run was deleted should be filtered silently."""
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
        await db.execute("DELETE FROM discovery_runs WHERE id = ?", (run_id,))
        await db.commit()

        result = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status=None,
            limit=50,
            cursor=None,
            actor=actor,
            db=db,
        )

        assert result.total == 0

    @pytest.mark.asyncio
    async def test_filters_by_status(self, db: object) -> None:
        """Status filter should exclude non-matching runs."""
        actor = _make_actor()

        running_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        completed_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Wichita, KS",
            state="KS",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryRunCRUD.complete(db, completed_id, queries_generated=1)

        for rid in (running_id, completed_id):
            await OwnershipCRUD.create_ownership(
                db,
                resource_id=rid,
                resource_type="discovery_run",
                org_id=ORG_ID,
                visibility="private",
                created_by="user_test_1",
            )

        result = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status="completed",
            limit=50,
            cursor=None,
            actor=actor,
            db=db,
        )

        assert result.total == 1
        assert result.items[0].id == completed_id

    @pytest.mark.asyncio
    async def test_pagination_with_cursor(self, db: object) -> None:
        """Cursor-based pagination should slice results correctly."""
        actor = _make_actor()

        run_ids = []
        for i in range(3):
            rid = await DiscoveryRunCRUD.create(
                db,
                location_query=f"City {i}, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            )
            await OwnershipCRUD.create_ownership(
                db,
                resource_id=rid,
                resource_type="discovery_run",
                org_id=ORG_ID,
                visibility="private",
                created_by="user_test_1",
            )
            run_ids.append(rid)

        page1 = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status=None,
            limit=2,
            cursor=None,
            actor=actor,
            db=db,
        )

        assert page1.total == 3
        assert len(page1.items) == 2
        assert page1.next_cursor is not None

        page2 = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status=None,
            limit=2,
            cursor=page1.next_cursor,
            actor=actor,
            db=db,
        )

        assert len(page2.items) == 1
        assert page2.next_cursor is None

    @pytest.mark.asyncio
    async def test_org_mismatch_raises_403(self, db: object) -> None:
        """Attempting to list runs for a different org should raise 403."""
        actor = _make_actor("org_other")

        with pytest.raises(HTTPException) as exc_info:
            await list_org_discovery_runs(
                org_id=ORG_ID,
                response=None,
                status=None,
                limit=50,
                cursor=None,
                actor=actor,
                db=db,
            )

        assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
