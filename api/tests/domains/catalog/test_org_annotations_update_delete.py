"""Tests for org-scoped annotation HTTP endpoints."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.models import EntryCRUD

STATUS_OK = 200
STATUS_NO_CONTENT = 204
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404

ORG_ID = "local"


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
        member_test_client: object,
    ) -> None:
        """A member who is not the author and not admin/owner should get 403."""
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

        response = await member_test_client.put(
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
        member_test_client: object,
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

        response = await member_test_client.delete(
            f"/api/orgs/{ORG_ID}/annotations/{annotation.id}"
        )
        assert response.status_code == STATUS_FORBIDDEN
