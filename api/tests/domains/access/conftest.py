"""Shared access fixtures."""

from __future__ import annotations

import httpx
import pytest_asyncio

from atlas.config import Settings, get_settings
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.main import create_app

ORG_ID = "local"
USER_ID = "local-operator"


@pytest_asyncio.fixture
async def usage_client(test_settings: Settings) -> object:
    """Test client whose local actor can read workspace usage summaries."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        actor = AuthenticatedActor(
            user_id=USER_ID,
            email="local@atlas.rebuildingus.org",
            auth_type="local",
            is_local=True,
            org_id=ORG_ID,
        )
        actor.org_role = "owner"
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
