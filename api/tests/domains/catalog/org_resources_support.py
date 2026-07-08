"""Shared fixtures and constants for org resource tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_actor, require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api.org_resources import get_directory_domain_verifier
from atlas.domains.catalog.services.directory_domains import DirectoryDomainVerificationService
from atlas.main import create_app

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_CONFLICT = 409
STATUS_NO_CONTENT = 204
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404
STATUS_UNPROCESSABLE_ENTITY = 422

# Local mode actor always has org_id="local"
ORG_ID = "local"
OTHER_ORG_ID = "other-org"

ENTRY_PAYLOAD = {
    "type": "organization",
    "name": "Test Private Org",
    "description": "A private entry owned by the local org.",
    "city": "Detroit",
    "state": "MI",
    "geo_specificity": "local",
    "issue_areas": ["housing_affordability"],
}


class _TestDirectoryDomainTxtResolver:
    """Mutable TXT resolver for directory-domain HTTP tests."""

    def __init__(self, records_by_domain: dict[str, set[str]], queries: list[str]) -> None:
        self.records_by_domain = records_by_domain
        self.queries = queries

    async def resolve_txt_records(self, domain: str) -> set[str]:
        """Return configured TXT records for ``domain``."""
        self.queries.append(domain)
        return self.records_by_domain.get(domain, set())


@pytest.fixture
def directory_domain_records() -> dict[str, set[str]]:
    """TXT records visible to the directory-domain verifier in HTTP tests."""
    return {}


@pytest.fixture
def directory_domain_queries() -> list[str]:
    """TXT names queried by the directory-domain verifier in HTTP tests."""
    return []


@pytest_asyncio.fixture
async def directory_capable_client(
    test_settings: Settings,
    directory_domain_records: dict[str, set[str]],
    directory_domain_queries: list[str],
) -> object:
    """Test client whose actor can publish workspace public directories."""
    app = create_app()
    txt_resolver = _TestDirectoryDomainTxtResolver(
        directory_domain_records,
        directory_domain_queries,
    )

    def override_get_settings() -> Settings:
        return test_settings

    def override_directory_domain_verifier() -> DirectoryDomainVerificationService:
        return DirectoryDomainVerificationService(txt_resolver=txt_resolver)

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
            capabilities=frozenset({"public.directories"}),
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
    app.dependency_overrides[get_directory_domain_verifier] = override_directory_domain_verifier

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
