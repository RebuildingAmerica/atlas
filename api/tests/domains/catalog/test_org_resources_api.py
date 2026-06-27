"""Tests for org-scoped private entry endpoints."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD, SourceCRUD

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_CONFLICT = 409
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

    @pytest.mark.asyncio
    async def test_update_with_empty_payload_returns_current_state(
        self, test_client: object
    ) -> None:
        """An update with no fields should succeed and return the unchanged entry."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        entry_id = create_resp.json()["id"]

        update_resp = await test_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}",
            json={},
        )
        assert update_resp.status_code == STATUS_OK
        assert update_resp.json()["id"] == entry_id
        assert update_resp.json()["name"] == ENTRY_PAYLOAD["name"]

    @pytest.mark.asyncio
    async def test_publish_entry_surfaces_it_in_public_directory(
        self, test_client: object, test_db: object
    ) -> None:
        """Published workspace entries should become a source-linked public directory."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        entry_id = create_resp.json()["id"]
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.test/tenant-directory-source",
            source_type="community_archive",
            extraction_method="manual",
            title="Tenant organizing directory source",
        )
        await SourceCRUD.link_to_entry(
            test_db,
            entry_id,
            source_id,
            "Source names Test Private Org as a tenant organizing actor.",
        )

        publish_resp = await test_client.put(f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish")
        assert publish_resp.status_code == STATUS_OK
        assert publish_resp.json()["visibility"] == "public"

        directory_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries/public-directory")
        assert directory_resp.status_code == STATUS_OK
        payload = directory_resp.json()
        assert payload["workspace"]["id"] == ORG_ID
        assert payload["trust_footer"]["label"] == "Powered by Atlas"
        assert payload["trust_footer"]["provenance_required"] is True
        assert payload["federation"] == {
            "label": "Shared with the Atlas commons",
            "shared_record_count": 1,
            "source_backed_record_count": 1,
            "review_required": True,
            "status": "open_with_review_gate",
            "minimum_confidence": "source-backed public record",
            "provenance_stamped_ingestion": True,
            "body": "Public records from this directory can be reused by other Atlas-powered directories only with source evidence and workspace review.",
        }
        assert len(payload["entries"]) == 1
        entry = payload["entries"][0]
        assert entry["id"] == entry_id
        assert entry["sources"][0]["id"] == source_id
        assert entry["claim_evidence"]["summary"]["source_count"] == 1

    @pytest.mark.asyncio
    async def test_publish_without_source_evidence_is_held_for_org_review(
        self, test_client: object, test_db: object
    ) -> None:
        """Tenant publishing should hold unsourced entries inside that tenant boundary."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        entry_id = create_resp.json()["id"]

        publish_resp = await test_client.put(f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish")
        assert publish_resp.status_code == STATUS_CONFLICT
        payload = publish_resp.json()
        assert payload["detail"]["entry_id"] == entry_id
        assert payload["detail"]["visibility"] == "private"
        assert payload["detail"]["hold_reason"] == "source_required_for_public_directory"
        assert payload["detail"]["review_item_id"]

        ownership = await OwnershipCRUD.get_ownership(test_db, entry_id, "entry")
        assert ownership is not None
        assert ownership.visibility == "private"
        pending = await ReviewQueueCRUD.list_pending(test_db, org_id=ORG_ID)
        assert [item.id for item in pending] == [payload["detail"]["review_item_id"]]
        assert pending[0].entity_id == entry_id
        assert pending[0].org_id == ORG_ID
        assert pending[0].kind == "tenant_publish"
        assert pending[0].hold_reason == "source_required_for_public_directory"

        directory_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries/public-directory")
        assert directory_resp.status_code == STATUS_OK
        assert directory_resp.json()["entries"] == []

    @pytest.mark.asyncio
    async def test_private_entries_stay_out_of_public_directory(self, test_client: object) -> None:
        """Private workspace entries should not leak into the public directory."""
        create_resp = await test_client.post(f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD)
        assert create_resp.status_code == STATUS_CREATED

        directory_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries/public-directory")
        assert directory_resp.status_code == STATUS_OK
        assert directory_resp.json()["entries"] == []

    @pytest.mark.asyncio
    async def test_directory_templates_seed_issue_place_and_taxonomy_scope(
        self, test_client: object
    ) -> None:
        """Workspace directory templates should expose ready-to-use issue/place scope."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/entries/directory-templates")
        assert response.status_code == STATUS_OK
        payload = response.json()
        template = next(item for item in payload["templates"] if item["id"] == "housing-coalition")
        assert template["label"] == "Housing coalition map"
        assert template["place_scope"]["geo_specificity"] == "local"
        assert "housing_affordability" in template["issue_area_ids"]
        assert "organization" in template["entry_types"]

    @pytest.mark.asyncio
    async def test_verified_custom_domain_is_exposed_on_public_directory(
        self, test_client: object
    ) -> None:
        """Verified tenant domains should be visible on the public directory trust surface."""
        create_resp = await test_client.post(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED
        domain_payload = create_resp.json()
        assert domain_payload["domain"] == "guide.kctenants.org"
        assert domain_payload["status"] == "pending"
        assert domain_payload["verification_token"].startswith("atlas-verify=")

        verify_resp = await test_client.post(
            f"/api/orgs/{ORG_ID}/entries/directory-domain/verify",
            json={"txt_record": domain_payload["verification_token"]},
        )
        assert verify_resp.status_code == STATUS_OK
        assert verify_resp.json()["status"] == "verified"

        directory_resp = await test_client.get(f"/api/orgs/{ORG_ID}/entries/public-directory")
        assert directory_resp.status_code == STATUS_OK
        payload = directory_resp.json()
        assert payload["workspace"]["custom_domain"] == {
            "domain": "guide.kctenants.org",
            "status": "verified",
        }


class TestOrgEntriesOrphanOwnership:
    """Stale ownership rows pointing at deleted entries should still 404 cleanly."""

    @pytest.mark.asyncio
    async def test_list_skips_ownership_rows_with_missing_entry(
        self, test_client: object, test_db: object
    ) -> None:
        """List endpoint should skip ownership rows whose entry has been deleted."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Live Org",
            description="Will remain.",
            city="Detroit",
            state="MI",
            geo_specificity="local",
        )
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id=entry_id,
            resource_type="entry",
            org_id=ORG_ID,
            visibility="private",
            created_by="local-user",
        )
        # Add a stale ownership pointing at a non-existent entry id.
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id="ghost-entry-id",
            resource_type="entry",
            org_id=ORG_ID,
            visibility="private",
            created_by="local-user",
        )

        response = await test_client.get(f"/api/orgs/{ORG_ID}/entries")
        assert response.status_code == STATUS_OK
        ids = {e["id"] for e in response.json()}
        assert entry_id in ids
        assert "ghost-entry-id" not in ids

    @pytest.mark.asyncio
    async def test_get_returns_404_when_entry_was_deleted(
        self, test_client: object, test_db: object
    ) -> None:
        """If ownership remains but the entry row is gone, get should 404."""
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id="ghost-entry-id",
            resource_type="entry",
            org_id=ORG_ID,
            visibility="private",
            created_by="local-user",
        )
        response = await test_client.get(f"/api/orgs/{ORG_ID}/entries/ghost-entry-id")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_returns_404_when_entry_was_deleted(
        self, test_client: object, test_db: object
    ) -> None:
        """If ownership remains but the entry row is gone, update should 404."""
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id="ghost-entry-id",
            resource_type="entry",
            org_id=ORG_ID,
            visibility="private",
            created_by="local-user",
        )
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/entries/ghost-entry-id",
            json={"name": "x"},
        )
        assert response.status_code == STATUS_NOT_FOUND
