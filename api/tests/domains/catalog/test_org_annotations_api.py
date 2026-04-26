"""Tests for org-scoped annotation HTTP endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_NO_CONTENT = 204
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404

ORG_ID = "local"
OTHER_ORG_ID = "other-org"
USER_ID = "local-operator"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def capable_test_client(test_settings: Settings) -> object:
    """Test client whose local actor has the workspace.notes capability.

    Overrides require_org_actor to inject an actor with the full capability
    set so that annotation creation can be exercised in tests.
    """
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

    app.dependency_overrides[get_settings] = override_get_settings
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


# ---------------------------------------------------------------------------
# Access guard tests
# ---------------------------------------------------------------------------


class TestOrgAnnotationsAccess:
    """Org access guard for annotation endpoints."""

    @pytest.mark.asyncio
    async def test_list_rejects_wrong_org(self, test_client: object) -> None:
        """Listing annotations for a different org should return 403."""
        response = await test_client.get(f"/api/orgs/{OTHER_ORG_ID}/annotations")
        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_create_without_capability_returns_403(self, test_client: object) -> None:
        """Creating an annotation without workspace.notes capability returns 403."""
        response = await test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"entry_id": "any-id", "content": "test"},
        )
        assert response.status_code == STATUS_FORBIDDEN


# ---------------------------------------------------------------------------
# CRUD tests
# ---------------------------------------------------------------------------


class TestOrgAnnotationsList:
    """GET /api/orgs/{org_id}/annotations"""

    @pytest.mark.asyncio
    async def test_list_returns_empty_initially(self, test_client: object) -> None:
        """An org with no annotations should return an empty list."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        assert response.status_code == STATUS_OK
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_list_returns_seeded_annotations(
        self,
        test_client: object,
        sample_annotation_id: str,
    ) -> None:
        """Seeded annotations should appear in the list response."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        assert response.status_code == STATUS_OK
        items = response.json()
        assert any(a["id"] == sample_annotation_id for a in items)

    @pytest.mark.asyncio
    async def test_list_filtered_by_entry_id(
        self,
        test_client: object,
        sample_annotation_id: str,
    ) -> None:
        """entry_id query param should filter annotations to that entry."""
        # Resolve the entry_id from the seeded annotation
        all_resp = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        seeded = next(a for a in all_resp.json() if a["id"] == sample_annotation_id)
        target_entry_id = seeded["entry_id"]

        filtered = await test_client.get(
            f"/api/orgs/{ORG_ID}/annotations",
            params={"entry_id": target_entry_id},
        )
        assert filtered.status_code == STATUS_OK
        items = filtered.json()
        assert all(a["entry_id"] == target_entry_id for a in items)
        assert any(a["id"] == sample_annotation_id for a in items)


class TestOrgAnnotationsCreate:
    """POST /api/orgs/{org_id}/annotations"""

    @pytest.mark.asyncio
    async def test_create_annotation(
        self,
        capable_test_client: object,
        sample_entry_for_annotation: str,
    ) -> None:
        """Creating an annotation with capability should return 201 with the annotation."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"entry_id": sample_entry_for_annotation, "content": "Great org!"},
        )
        assert response.status_code == STATUS_CREATED
        data = response.json()
        assert data["content"] == "Great org!"
        assert data["entry_id"] == sample_entry_for_annotation
        assert data["org_id"] == ORG_ID

    @pytest.mark.asyncio
    async def test_create_annotation_with_missing_entry_returns_404(
        self,
        capable_test_client: object,
    ) -> None:
        """Creating an annotation for a nonexistent entry should return 404."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"entry_id": "nonexistent-entry-id", "content": "Note"},
        )
        assert response.status_code == STATUS_NOT_FOUND


class TestOrgAnnotationsUpdate:
    """PUT /api/orgs/{org_id}/annotations/{annotation_id}"""

    @pytest.mark.asyncio
    async def test_update_annotation(
        self,
        test_client: object,
        sample_annotation_id: str,
    ) -> None:
        """Updating an annotation should persist the new content."""
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/annotations/{sample_annotation_id}",
            json={"content": "Updated content."},
        )
        assert response.status_code == STATUS_OK
        assert response.json()["content"] == "Updated content."

    @pytest.mark.asyncio
    async def test_update_nonexistent_annotation_returns_404(self, test_client: object) -> None:
        """Updating an annotation that does not exist should return 404."""
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/annotations/nonexistent-id",
            json={"content": "x"},
        )
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_by_non_author_non_admin_returns_403(
        self,
        test_db: object,
        test_client: object,
    ) -> None:
        """A member who is not the author and not admin/owner should get 403."""
        # Seed an annotation authored by a different user
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Conflict Entry",
            description="For permission conflict test.",
            city="Houston",
            state="TX",
            geo_specificity="local",
        )
        annotation = await OwnershipCRUD.create_annotation(
            test_db,
            org_id=ORG_ID,
            entry_id=entry_id,
            content="By another user",
            author_id="other-user-id",
        )
        await test_db.commit()

        # Local actor (user_id="local-operator") is not the author; no org_role set
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/annotations/{annotation.id}",
            json={"content": "Attempting override"},
        )
        assert response.status_code == STATUS_FORBIDDEN


class TestOrgAnnotationsDelete:
    """DELETE /api/orgs/{org_id}/annotations/{annotation_id}"""

    @pytest.mark.asyncio
    async def test_delete_annotation(
        self,
        test_client: object,
        sample_annotation_id: str,
    ) -> None:
        """Deleting an annotation should return 204 and remove it."""
        response = await test_client.delete(
            f"/api/orgs/{ORG_ID}/annotations/{sample_annotation_id}"
        )
        assert response.status_code == STATUS_NO_CONTENT

        # Confirm it's gone
        list_resp = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        ids = [a["id"] for a in list_resp.json()]
        assert sample_annotation_id not in ids

    @pytest.mark.asyncio
    async def test_delete_nonexistent_annotation_returns_404(self, test_client: object) -> None:
        """Deleting an annotation that does not exist should return 404."""
        response = await test_client.delete(f"/api/orgs/{ORG_ID}/annotations/nonexistent-id")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_by_non_author_non_admin_returns_403(
        self,
        test_db: object,
        test_client: object,
    ) -> None:
        """A non-author, non-admin member should get 403 on delete."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Delete Conflict Entry",
            description="For delete permission conflict test.",
            city="Phoenix",
            state="AZ",
            geo_specificity="local",
        )
        annotation = await OwnershipCRUD.create_annotation(
            test_db,
            org_id=ORG_ID,
            entry_id=entry_id,
            content="By another user",
            author_id="other-user-id",
        )
        await test_db.commit()

        response = await test_client.delete(f"/api/orgs/{ORG_ID}/annotations/{annotation.id}")
        assert response.status_code == STATUS_FORBIDDEN
