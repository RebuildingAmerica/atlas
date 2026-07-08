"""Shared helpers for org coverage target tests."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_BAD_REQUEST = 400
STATUS_FORBIDDEN = 403
COVERED_RECORDS = 4
COVERED_SOURCES = 5
COVERAGE_STALE_DAYS = 90
IMPORTED_TARGET_COUNT = 2
INVALID_IMPORT_ROW = 3
ORG_ID = "local"


@pytest_asyncio.fixture
async def capable_test_client(test_settings: Settings) -> object:
    """Test client whose local actor can manage coverage targets."""
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
            capabilities=frozenset({"monitoring.watchlists", "research.run", "workspace.export"}),
            limits={},
        )
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _create_entry_with_source(test_db: object, name: str) -> str:
    """Create an entry linked to one source receipt."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name=name,
        description="Coverage target evidence.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url=f"https://example.test/{entry_id}",
        source_type="community_archive",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    return entry_id


async def _create_completed_run(
    test_db: object,
    *,
    entries_confirmed: int,
    sources_processed: int,
    completed_at: datetime | None = None,
) -> str:
    """Create a private completed discovery run with summary counts."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="coverage_review",
    )
    await DiscoveryRunCRUD.update(
        test_db,
        run_id,
        status="completed",
        completed_at=(completed_at or datetime.now(UTC)).isoformat(),
        entries_confirmed=entries_confirmed,
        sources_processed=sources_processed,
    )
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id=ORG_ID,
        visibility="private",
        created_by="local-user",
    )
    return run_id


def _target_payload(
    *,
    linked_discovery_run_ids: list[str] | None = None,
    linked_entry_ids: list[str] | None = None,
    last_reviewed_at: str | None = None,
) -> dict[str, object]:
    """Return a coverage-target create payload."""
    payload: dict[str, object] = {
        "name": "Kansas City tenant power",
        "geography": "Kansas City, MO",
        "issue_areas": ["housing_affordability"],
        "actor_types": ["organization"],
        "source_types": ["community_archive"],
        "linked_discovery_run_ids": linked_discovery_run_ids or [],
        "linked_entry_ids": linked_entry_ids or [],
        "gaps": [
            {
                "label": "County tenant groups",
                "detail": "Review county-level tenant organizations.",
            }
        ],
        "next_actions": ["Review county source coverage"],
    }
    if last_reviewed_at is not None:
        payload["last_reviewed_at"] = last_reviewed_at
    return payload
