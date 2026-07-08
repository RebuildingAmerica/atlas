"""Shared helpers for org brief tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_actor, require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

ORG_ID = "local"
OTHER_ORG_ID = "other-org"


@pytest_asyncio.fixture
async def briefs_capable_test_client(test_settings: Settings) -> object:
    """Test client whose local actor can create workspace brief artifacts."""
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
            capabilities=frozenset({"research.run", "workspace.export"}),
            limits={},
        )
        return actor

    async def override_require_actor() -> AuthenticatedActor:
        actor = await override_require_org_actor()
        actor.org_id = None
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_actor] = override_require_actor
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def briefs_limited_test_client(test_settings: Settings) -> object:
    """Test client whose actor lacks paid workspace export capability."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        actor = AuthenticatedActor(
            user_id="limited-user",
            email="limited@atlas.rebuildingus.org",
            auth_type="oauth_jwt",
            org_id=ORG_ID,
        )
        actor.resolved_capabilities = ResolvedCapabilities(
            capabilities=frozenset({"research.run"}),
            limits={},
        )
        return actor

    async def override_require_actor() -> AuthenticatedActor:
        actor = await override_require_org_actor()
        actor.org_id = None
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_actor] = override_require_actor
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _create_linked_records(test_db: object) -> tuple[str, str, str]:
    """Create one entry, source, and discovery run that can anchor a brief."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Kansas City Tenant Union",
        description="A source-backed housing organization.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/kc-tenant-union",
        source_type="community_archive",
        extraction_method="manual",
        title="Kansas City Tenant Union profile",
    )
    await SourceCRUD.link_to_entry(
        test_db,
        entry_id,
        source_id,
        "Source names the organization and its housing work.",
    )
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="landscape_scan",
    )
    return entry_id, source_id, run_id


def _brief_payload(entry_id: str, source_id: str, run_id: str) -> dict[str, object]:
    """Return a complete create payload for a workspace brief."""
    return {
        "title": "Kansas City housing landscape brief",
        "scope": {
            "geography": "Kansas City, MO",
            "issue_areas": ["housing_affordability"],
            "actor_types": ["organization"],
            "source_types": ["community_archive"],
        },
        "summary": "One source-backed housing lead is ready for review.",
        "linked_entry_ids": [entry_id],
        "linked_source_ids": [source_id],
        "linked_discovery_run_ids": [run_id],
        "confidence_summary": {
            "state": "partial",
            "source_count": 1,
            "review_status": "operator_review_required",
        },
        "gaps": [
            {
                "label": "County coverage",
                "detail": "No county-level tenant source has been reviewed yet.",
            }
        ],
    }
