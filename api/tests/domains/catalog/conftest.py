"""Shared catalog profile fixtures."""

from __future__ import annotations

import httpx
import pytest_asyncio

from atlas.config import Settings, get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_actor, require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

pytest_plugins = ["tests.domains.catalog.org_resources_support"]

ORG_ID = "local"
OTHER_ORG_ID = "other-org"
USER_ID = "local-operator"


@pytest_asyncio.fixture
async def claimable_org(test_db: object) -> str:
    """Create an org with a clear email/website domain to support tier-1 claims."""
    return await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Mississippi Rising",
        description="Statewide organizing nonprofit.",
        city="Jackson",
        state="MS",
        geo_specificity="statewide",
        website="https://mississippirising.org",
        email="info@mississippirising.org",
    )


@pytest_asyncio.fixture
async def claimable_person(test_db: object) -> str:
    """Create a person without contact info — tier-2 claim path only."""
    return await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Marcus Lee",
        description="Tenant advocate in Tupelo.",
        city="Tupelo",
        state="MS",
        geo_specificity="local",
    )


@pytest_asyncio.fixture
async def capable_test_client(test_settings: Settings) -> object:
    """Test client whose local actor has the workspace.notes capability."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        caps = frozenset({"research.run", "workspace.notes"})
        actor = AuthenticatedActor(
            user_id=USER_ID,
            email="local@atlas.rebuildingus.org",
            auth_type="local",
            is_local=True,
            org_id=ORG_ID,
        )
        actor.org_role = "owner"
        actor.resolved_capabilities = ResolvedCapabilities(
            capabilities=caps,
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
async def no_notes_capability_client(test_settings: Settings) -> object:
    """Test client whose local actor belongs to the org but cannot create notes."""
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


@pytest_asyncio.fixture
async def member_test_client(test_settings: Settings) -> object:
    """Test client whose local actor is an org member, not an admin or owner."""
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
        actor.org_role = "member"
        actor.resolved_capabilities = ResolvedCapabilities(
            capabilities=frozenset({"research.run", "workspace.notes"}),
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
async def sample_annotation_id(test_db: object) -> str:
    """Seed an annotation directly so update/delete endpoints can be exercised."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Annotated Org",
        description="For annotation tests.",
        city="Chicago",
        state="IL",
        geo_specificity="local",
    )
    annotation = await OwnershipCRUD.create_annotation(
        test_db,
        org_id=ORG_ID,
        entry_id=entry_id,
        content="Initial annotation content.",
        author_id=USER_ID,
    )
    await test_db.commit()
    return annotation.id


@pytest_asyncio.fixture
async def sample_entry_for_annotation(test_db: object) -> str:
    """Seed an entry that can be annotated via HTTP."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Entry For Annotation",
        description="Target entry for annotation creation test.",
        city="Miami",
        state="FL",
        geo_specificity="local",
    )
    await test_db.commit()
    return entry_id


@pytest_asyncio.fixture
async def sample_source_for_annotation(test_db: object) -> str:
    """Seed a source that can be annotated via HTTP."""
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.org/source-note",
        source_type="news_article",
        extraction_method="manual",
        title="Source note target",
        publication="Local Paper",
    )
    await test_db.commit()
    return source_id
