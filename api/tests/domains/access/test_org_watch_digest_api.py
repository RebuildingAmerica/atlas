"""Tests for org-scoped watch digest events."""

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
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_FORBIDDEN = 403
ORG_ID = "local"


@pytest_asyncio.fixture
async def digest_client(test_settings: Settings) -> object:
    """Test client whose local actor can read workspace monitoring digest events."""
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


async def _create_entry(test_db: object, name: str = "KC Tenants") -> str:
    """Create one organization entry that can receive source updates."""
    return await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name=name,
        description="Tenant power organization.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )


async def _create_source(test_db: object, slug: str, title: str = "Tenant update") -> str:
    """Create one source receipt for a watched actor."""
    return await SourceCRUD.create(
        test_db,
        url=f"https://example.test/{slug}",
        source_type="community_archive",
        extraction_method="manual",
        title=title,
        publication="Example Civic News",
    )


class TestOrgWatchDigestSchema:
    """Schema coverage for workspace change events."""

    @pytest.mark.asyncio
    async def test_init_db_creates_org_change_events_table(self, test_db: object) -> None:
        """Fresh databases should include workspace change events."""
        cursor = await test_db.execute("PRAGMA table_info(org_change_events)")
        columns = {row[1] for row in await cursor.fetchall()}

        assert {
            "id",
            "org_id",
            "resource_type",
            "resource_id",
            "event_type",
            "title",
            "summary",
            "source_id",
            "entry_id",
            "created_at",
        }.issubset(columns)


class TestOrgWatchDigestApi:
    """Org-scoped digest behavior."""

    @pytest.mark.asyncio
    async def test_watched_entry_new_source_appears_in_digest(
        self,
        digest_client: object,
        test_db: object,
    ) -> None:
        """A watched actor with new source evidence should appear in the digest."""
        entry_id = await _create_entry(test_db)
        source_id = await _create_source(test_db, "kc-tenants")

        watch_response = await digest_client.put(f"/api/orgs/{ORG_ID}/watches/entry/{entry_id}")
        await SourceCRUD.link_to_entry(test_db, entry_id, source_id, "Tenant meeting coverage.")
        digest_response = await digest_client.get(f"/api/orgs/{ORG_ID}/watch-digest")

        assert watch_response.status_code == STATUS_CREATED
        assert digest_response.status_code == STATUS_OK
        body = digest_response.json()
        assert body["total"] == 1
        assert body["source_signal_count"] == 1
        assert body["coverage_signal_count"] == 0
        assert body["items"][0]["event_type"] == "new_source"
        assert body["items"][0]["resource_type"] == "entry"
        assert body["items"][0]["resource_id"] == entry_id
        assert body["items"][0]["entry"]["name"] == "KC Tenants"
        assert body["items"][0]["source"]["id"] == source_id
        assert body["items"][0]["source"]["title"] == "Tenant update"
        assert body["items"][0]["source"]["url"] == "https://example.test/kc-tenants"
        usage_counts = await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID)
        assert usage_counts["digest_viewed"] == 1
        assert usage_counts["watch_created"] == 1

    @pytest.mark.asyncio
    async def test_unwatched_entry_new_source_is_hidden(
        self,
        digest_client: object,
        test_db: object,
    ) -> None:
        """Digest rows should only appear for resources the workspace watches."""
        entry_id = await _create_entry(test_db)
        source_id = await _create_source(test_db, "unwatched")

        await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
        digest_response = await digest_client.get(f"/api/orgs/{ORG_ID}/watch-digest")

        assert digest_response.status_code == STATUS_OK
        assert digest_response.json()["items"] == []
        assert digest_response.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_muted_watch_is_omitted_from_digest(
        self,
        digest_client: object,
        test_db: object,
    ) -> None:
        """Muted watches should preserve state without adding digest noise."""
        entry_id = await _create_entry(test_db)
        source_id = await _create_source(test_db, "muted")

        await digest_client.put(
            f"/api/orgs/{ORG_ID}/watches/entry/{entry_id}",
            json={"notification_preference": "muted"},
        )
        await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
        digest_response = await digest_client.get(f"/api/orgs/{ORG_ID}/watch-digest")

        assert digest_response.status_code == STATUS_OK
        assert digest_response.json()["items"] == []
        assert digest_response.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_rejects_other_org_path(self, digest_client: object) -> None:
        """The digest path should stay inside the actor's workspace."""
        response = await digest_client.get("/api/orgs/other-org/watch-digest")

        assert response.status_code == STATUS_FORBIDDEN
