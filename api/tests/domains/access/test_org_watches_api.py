"""Tests for org-scoped workspace watches."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_NO_CONTENT = 204
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404
EXPECTED_WATCH_COUNT = 2

ORG_ID = "local"


@pytest_asyncio.fixture
async def watch_client(test_settings: Settings) -> object:
    """Test client whose local actor can manage workspace watches."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        actor = AuthenticatedActor(
            user_id="local-user",
            email="local@atlas.rebuildingus.org",
            auth_type="local",
            is_local=True,
            org_id=ORG_ID,
        )
        actor.org_role = "owner"
        actor.resolved_capabilities = ResolvedCapabilities(
            capabilities=frozenset({"monitoring.watchlists", "research.run"}),
            limits={},
        )
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _create_entry(test_db: object) -> str:
    """Create one organization entry that can be watched by a workspace."""
    return await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="KC Tenants",
        description="Tenant power organization.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )


async def _create_coverage_target(test_db: object, *, org_id: str = ORG_ID) -> str:
    """Create one coverage target that can be watched by a workspace."""
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id=org_id,
        name="Kansas City tenant power",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="local-user",
    )
    return target.id


class TestOrgWatchesSchema:
    """Schema coverage for workspace watches."""

    @pytest.mark.asyncio
    async def test_init_db_creates_org_watches_table(self, test_db: object) -> None:
        """Fresh databases should include workspace watch state."""
        cursor = await test_db.execute("PRAGMA table_info(org_watches)")
        columns = {row[1] for row in await cursor.fetchall()}

        assert {
            "id",
            "org_id",
            "resource_type",
            "resource_id",
            "notification_preference",
            "created_by",
            "created_at",
            "updated_at",
        }.issubset(columns)


class TestOrgWatchesApi:
    """Org-scoped watch behavior."""

    @pytest.mark.asyncio
    async def test_watch_entry_and_coverage_target(
        self,
        watch_client: object,
        test_db: object,
    ) -> None:
        """A workspace can watch source-backed actors and coverage targets."""
        entry_id = await _create_entry(test_db)
        target_id = await _create_coverage_target(test_db)

        entry_response = await watch_client.put(
            f"/api/orgs/{ORG_ID}/watches/entry/{entry_id}",
        )
        target_response = await watch_client.put(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}",
            json={"notification_preference": "immediate"},
        )
        list_response = await watch_client.get(f"/api/orgs/{ORG_ID}/watches")

        assert entry_response.status_code == STATUS_CREATED
        assert entry_response.json()["resource_type"] == "entry"
        assert entry_response.json()["resource_id"] == entry_id
        assert entry_response.json()["notification_preference"] == "digest"
        assert target_response.status_code == STATUS_CREATED
        assert target_response.json()["resource_type"] == "coverage_target"
        assert target_response.json()["resource_id"] == target_id
        assert target_response.json()["notification_preference"] == "immediate"
        assert list_response.status_code == STATUS_OK
        assert list_response.json()["total"] == EXPECTED_WATCH_COUNT
        assert await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID) == {"watch_created": 2}

    @pytest.mark.asyncio
    async def test_get_and_delete_watch_status(
        self,
        watch_client: object,
        test_db: object,
    ) -> None:
        """Watch status should be readable and removable without ambiguity."""
        target_id = await _create_coverage_target(test_db)
        await watch_client.put(f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}")

        status_response = await watch_client.get(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}",
        )
        delete_response = await watch_client.delete(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}",
        )
        removed_response = await watch_client.get(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}",
        )

        assert status_response.status_code == STATUS_OK
        assert status_response.json()["watched"] is True
        assert status_response.json()["watch"]["resource_id"] == target_id
        assert delete_response.status_code == STATUS_NO_CONTENT
        assert removed_response.status_code == STATUS_OK
        assert removed_response.json() == {"watched": False, "watch": None}

    @pytest.mark.asyncio
    async def test_rejects_unknown_resource(self, watch_client: object) -> None:
        """A workspace should not be able to watch a missing resource."""
        response = await watch_client.put(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/missing-target",
        )

        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_rejects_other_workspace_target(
        self,
        watch_client: object,
        test_db: object,
    ) -> None:
        """A workspace should not be able to watch another org's coverage target."""
        target_id = await _create_coverage_target(test_db, org_id="other-org")

        response = await watch_client.put(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}",
        )

        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_rejects_other_org_path(self, watch_client: object, test_db: object) -> None:
        """The org path should match the actor before watch state is read."""
        entry_id = await _create_entry(test_db)

        response = await watch_client.put(f"/api/orgs/other-org/watches/entry/{entry_id}")

        assert response.status_code == STATUS_FORBIDDEN
