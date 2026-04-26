"""Tests for org-scoped private entry endpoints."""

from __future__ import annotations

import pytest

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_NO_CONTENT = 204
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404

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


class TestOrgEntriesAccess:
    """Org access guard for private entry endpoints."""

    @pytest.mark.asyncio
    async def test_list_rejects_wrong_org(self, test_client: object) -> None:
        """Requests for a different org should be rejected with 403."""
        response = await test_client.get(f"/api/orgs/{OTHER_ORG_ID}/entries")
        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_create_rejects_wrong_org(self, test_client: object) -> None:
        """Creating an entry for a different org should be rejected with 403."""
        response = await test_client.post(f"/api/orgs/{OTHER_ORG_ID}/entries", json=ENTRY_PAYLOAD)
        assert response.status_code == STATUS_FORBIDDEN


class TestOrgEntriesCRUD:
    """Happy-path CRUD for org-scoped private entries."""

    @pytest.mark.asyncio
    async def test_list_returns_empty_initially(self, test_client: object) -> None:
        """Listing entries for an org with no private entries should return an empty list."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/entries")
        assert response.status_code == STATUS_OK
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_create_and_list_entry(self, test_client: object) -> None:
        """Creating a private entry should persist it and appear in the list."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        assert create_resp.status_code == STATUS_CREATED
        data = create_resp.json()
        assert data["name"] == ENTRY_PAYLOAD["name"]
        assert data["type"] == ENTRY_PAYLOAD["type"]

        list_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries")
        assert list_resp.status_code == STATUS_OK
        entries = list_resp.json()
        assert any(e["name"] == ENTRY_PAYLOAD["name"] for e in entries)

    @pytest.mark.asyncio
    async def test_get_entry(self, test_client: object) -> None:
        """Getting a specific private entry by ID should return it."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        entry_id = create_resp.json()["id"]

        get_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries/{entry_id}")
        assert get_resp.status_code == STATUS_OK
        assert get_resp.json()["id"] == entry_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_entry_returns_404(self, test_client: object) -> None:
        """Getting an entry that does not exist should return 404."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/entries/nonexistent-id")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_entry(self, test_client: object) -> None:
        """Updating an entry should persist the change."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        entry_id = create_resp.json()["id"]

        update_resp = await test_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}",
            json={"name": "Updated Name"},
        )
        assert update_resp.status_code == STATUS_OK
        assert update_resp.json()["name"] == "Updated Name"

    @pytest.mark.asyncio
    async def test_update_nonexistent_entry_returns_404(self, test_client: object) -> None:
        """Updating an entry that does not exist should return 404."""
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/entries/nonexistent-id",
            json={"name": "x"},
        )
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_entry(self, test_client: object) -> None:
        """Deleting a private entry should remove it."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        entry_id = create_resp.json()["id"]

        del_resp = await test_client.delete(f"/api/orgs/{ORG_ID}/entries/{entry_id}")
        assert del_resp.status_code == STATUS_NO_CONTENT

        get_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries/{entry_id}")
        assert get_resp.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_nonexistent_entry_returns_404(self, test_client: object) -> None:
        """Deleting an entry that does not exist should return 404."""
        response = await test_client.delete(f"/api/orgs/{ORG_ID}/entries/nonexistent-id")
        assert response.status_code == STATUS_NOT_FOUND
