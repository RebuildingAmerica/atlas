"""Tests for org-scoped private discovery run endpoints."""

from __future__ import annotations

from http import HTTPStatus
from types import SimpleNamespace

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.api_org import (
    OrgDiscoveryRunCollectionResponse,
    OrgDiscoveryRunResponse,
    OrgDiscoveryRunStartRequest,
    _run_to_org_response,
    _verify_org_access,
    get_org_discovery_run,
    list_org_discovery_runs,
    start_org_discovery_run,
)
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models.database import DB_SCHEMA

ORG_ID = "org_test_1"
USER_ID = "user_test_1"
USER_EMAIL = "test@atlas.test"


@pytest_asyncio.fixture
async def db() -> aiosqlite.Connection:
    """Create an in-memory database with schema."""
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(DB_SCHEMA)
    await conn.commit()
    yield conn
    await conn.close()


def _make_actor(org_id: str = ORG_ID) -> AuthenticatedActor:
    """Create a test authenticated actor with org context."""
    return AuthenticatedActor(
        user_id=USER_ID,
        email=USER_EMAIL,
        auth_type="local",
        is_local=True,
        org_id=org_id,
    )


class TestVerifyOrgAccess:
    """Tests for the _verify_org_access helper."""

    def test_matching_org_id_passes(self) -> None:
        """No exception should be raised when actor.org_id matches path org_id."""
        actor = _make_actor("org_123")
        _verify_org_access(actor, "org_123")

    def test_mismatched_org_id_raises_403(self) -> None:
        """A mismatch between actor and path org_id should raise HTTP 403."""
        actor = _make_actor("org_123")
        with pytest.raises(HTTPException) as exc_info:
            _verify_org_access(actor, "org_456")
        assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
        assert "mismatch" in exc_info.value.detail


class TestRunToOrgResponse:
    """Tests for the _run_to_org_response conversion helper."""

    def test_converts_discovery_run_model(self) -> None:
        """A DiscoveryRunModel should convert to an OrgDiscoveryRunResponse."""
        run = SimpleNamespace(
            id="run_1",
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
            queries_generated=10,
            sources_fetched=5,
            sources_processed=3,
            entries_extracted=2,
            entries_after_dedup=1,
            entries_confirmed=1,
            started_at="2026-01-01T00:00:00Z",
            completed_at="2026-01-01T01:00:00Z",
            status="completed",
            error_message=None,
            created_at="2026-01-01T00:00:00Z",
        )
        response = _run_to_org_response(run, ORG_ID)

        assert isinstance(response, OrgDiscoveryRunResponse)
        assert response.id == "run_1"
        assert response.org_id == ORG_ID
        assert response.location_query == "Kansas City, MO"
        assert response.status == "completed"
        assert response.issue_areas == ["housing_affordability"]


class TestListOrgDiscoveryRuns:
    """Tests for the list_org_discovery_runs endpoint."""

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_runs(self, db: aiosqlite.Connection) -> None:
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
    async def test_returns_owned_runs(self, db: aiosqlite.Connection) -> None:
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
            created_by=USER_ID,
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
    async def test_filters_by_status(self, db: aiosqlite.Connection) -> None:
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
                created_by=USER_ID,
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
    async def test_pagination_with_cursor(self, db: aiosqlite.Connection) -> None:
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
                created_by=USER_ID,
            )
            run_ids.append(rid)

        # Request first page with limit=2
        page1 = await list_org_discovery_runs(
            org_id=ORG_ID,
            response=None,
            status=None,
            limit=2,
            cursor=None,
            actor=actor,
            db=db,
        )

        num_runs = 3
        page_size = 2
        assert page1.total == num_runs
        assert len(page1.items) == page_size
        assert page1.next_cursor is not None

        # Request second page using cursor
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
    async def test_org_mismatch_raises_403(self, db: aiosqlite.Connection) -> None:
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


class TestStartOrgDiscoveryRun:
    """Tests for the start_org_discovery_run endpoint."""

    @pytest.mark.asyncio
    async def test_creates_run_with_ownership(self, db: aiosqlite.Connection) -> None:
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

        # Verify ownership record was created
        ownership = await OwnershipCRUD.get_ownership(db, result.id, "discovery_run")
        assert ownership is not None
        assert ownership.org_id == ORG_ID
        assert ownership.visibility == "private"

    @pytest.mark.asyncio
    async def test_invalid_issue_area_raises_400(self, db: aiosqlite.Connection) -> None:
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
    async def test_org_mismatch_raises_403(self, db: aiosqlite.Connection) -> None:
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


class TestGetOrgDiscoveryRun:
    """Tests for the get_org_discovery_run endpoint."""

    @pytest.mark.asyncio
    async def test_returns_owned_run(self, db: aiosqlite.Connection) -> None:
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
            created_by=USER_ID,
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
    async def test_returns_404_for_unowned_run(self, db: aiosqlite.Connection) -> None:
        """Fetching a run not owned by the org should raise 404."""
        actor = _make_actor()
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        # No ownership record created

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
    async def test_returns_404_for_wrong_org(self, db: aiosqlite.Connection) -> None:
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
    async def test_org_mismatch_raises_403(self, db: aiosqlite.Connection) -> None:
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
    async def test_returns_404_when_run_deleted(self, db: aiosqlite.Connection) -> None:
        """If an ownership record exists but the run itself is gone, return 404."""
        actor = _make_actor()
        run_id = "phantom_run_id"
        # Create ownership record for a non-existent run
        await OwnershipCRUD.create_ownership(
            db,
            resource_id=run_id,
            resource_type="discovery_run",
            org_id=ORG_ID,
            visibility="private",
            created_by=USER_ID,
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
