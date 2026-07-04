"""Tests for org-scoped private entry endpoints."""

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
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

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


@pytest_asyncio.fixture
async def directory_capable_client(test_settings: Settings) -> object:
    """Test client whose actor can publish workspace public directories."""
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
            capabilities=frozenset({"public.directories"}),
            limits={},
        )
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


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
    async def test_init_db_creates_directory_config_table(self, test_db: object) -> None:
        """Fresh databases should include editable public directory config."""
        cursor = await test_db.execute("PRAGMA table_info(org_directory_configs)")
        columns = {row[1] for row in await cursor.fetchall()}

        assert {
            "org_id",
            "title",
            "sponsor_label",
            "issue_area_ids_json",
            "geography_labels_json",
            "entry_types_json",
            "methodology_summary",
            "source_policy",
            "review_policy",
            "correction_policy",
            "correction_path_template",
            "missing_context_path_template",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        }.issubset(columns)

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
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """Published workspace entries should become a source-linked public directory."""
        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD
        )
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

        publish_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )
        assert publish_resp.status_code == STATUS_OK
        assert publish_resp.json()["visibility"] == "public"

        directory_resp = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/public-directory"
        )
        assert directory_resp.status_code == STATUS_OK
        payload = directory_resp.json()
        assert payload["title"] == "Detroit, MI civic directory"
        assert payload["sponsor_label"] is None
        assert payload["scope"] == {
            "issue_area_ids": ["housing_affordability"],
            "geography_labels": ["Detroit, MI"],
            "entry_types": ["organization"],
        }
        assert payload["stats"]["record_count"] == 1
        assert payload["stats"]["source_count"] == 1
        assert payload["stats"]["source_backed_record_count"] == 1
        assert payload["stats"]["last_reviewed_at"] is not None
        assert payload["publication"] == {
            "visibility": "public",
            "private_notes_exposed": False,
        }
        assert payload["methodology"] == {
            "summary": "Records qualify after workspace review and linked source evidence.",
            "source_policy": "Every public record includes at least one linked source packet.",
            "review_policy": "Unsourced workspace records are held for review before publication.",
            "correction_policy": "Each listed record accepts stale, incorrect, or missing-context feedback.",
            "correction_path_template": "/feedback/{slug}?kind=incorrect",
            "missing_context_path_template": "/feedback/{slug}?kind=missing_context",
        }
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
    async def test_public_directory_index_lists_source_backed_published_directories(
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """Sitemaps should discover only directories with public published records."""
        empty_resp = await directory_capable_client.get("/api/public-directories")
        assert empty_resp.status_code == STATUS_OK
        assert empty_resp.json() == {"directories": []}

        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD
        )
        entry_id = create_resp.json()["id"]
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.test/public-directory-index-source",
            source_type="community_archive",
            extraction_method="manual",
            title="Public directory index source",
        )
        await SourceCRUD.link_to_entry(
            test_db,
            entry_id,
            source_id,
            "Source names Test Private Org as a public directory actor.",
        )

        publish_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )
        assert publish_resp.status_code == STATUS_OK

        index_resp = await directory_capable_client.get("/api/public-directories")
        assert index_resp.status_code == STATUS_OK
        payload = index_resp.json()
        assert payload["directories"] == [
            {
                "org_id": ORG_ID,
                "record_count": 1,
                "last_published_at": payload["directories"][0]["last_published_at"],
            }
        ]
        assert payload["directories"][0]["last_published_at"] is not None

    @pytest.mark.asyncio
    async def test_publish_requires_public_directory_capability(
        self, test_client: object, test_db: object
    ) -> None:
        """Only directory-capable workspaces should publish into a public directory."""
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

        assert publish_resp.status_code == STATUS_FORBIDDEN
        detail = publish_resp.json()["detail"]
        assert detail["error"] == "plan_required"
        assert detail["capability"] == "public.directories"
        assert detail["plan_required"] == "civic_operating_layer"

    @pytest.mark.asyncio
    async def test_publish_records_public_map_improvement(
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """Publishing a sourced record should count toward public-good renewal impact."""
        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD
        )
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

        publish_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )

        assert publish_resp.status_code == STATUS_OK
        usage_counts = await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID)
        assert usage_counts["public_record_improved"] == 1

    @pytest.mark.asyncio
    async def test_republishing_public_entry_does_not_double_count_improvement(
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """Renewal impact should count the public-record improvement once."""
        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD
        )
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

        first_publish = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )
        second_publish = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )

        assert first_publish.status_code == STATUS_OK
        assert second_publish.status_code == STATUS_OK
        usage_counts = await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID)
        assert usage_counts["public_record_improved"] == 1

    @pytest.mark.asyncio
    async def test_publish_without_source_evidence_is_held_for_org_review(
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """Tenant publishing should hold unsourced entries inside that tenant boundary."""
        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD
        )
        entry_id = create_resp.json()["id"]

        publish_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )
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

        directory_resp = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/public-directory"
        )
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
        self, directory_capable_client: object
    ) -> None:
        """Workspace directory templates should expose ready-to-use issue/place scope."""
        response = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/directory-templates"
        )
        assert response.status_code == STATUS_OK
        payload = response.json()
        template = next(item for item in payload["templates"] if item["id"] == "housing-coalition")
        assert template["label"] == "Housing coalition map"
        assert template["place_scope"]["geo_specificity"] == "local"
        assert "housing_affordability" in template["issue_area_ids"]
        assert "organization" in template["entry_types"]

    @pytest.mark.asyncio
    async def test_directory_templates_require_public_directory_capability(
        self, test_client: object
    ) -> None:
        """Directory templates should belong to directory-capable packages."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/entries/directory-templates")

        assert response.status_code == STATUS_FORBIDDEN
        detail = response.json()["detail"]
        assert detail["error"] == "plan_required"
        assert detail["capability"] == "public.directories"

    @pytest.mark.asyncio
    async def test_directory_config_controls_public_directory_metadata(
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """Directory config should let partners publish a clear issue/place offer."""
        config_payload = {
            "title": "Detroit tenant power directory",
            "sponsor_label": "Supported by Detroit Housing Fund",
            "scope": {
                "issue_area_ids": ["housing_affordability"],
                "geography_labels": ["Detroit, MI"],
                "entry_types": ["organization"],
            },
            "methodology": {
                "summary": "Reviewed tenant-power records with linked public sources.",
                "source_policy": "Each listing includes a public source reviewed by Atlas operators.",
                "review_policy": "Records are checked before they appear in this public directory.",
                "correction_policy": "Readers can send stale facts or missing context for review.",
                "correction_path_template": "/feedback/{slug}?kind=incorrect",
                "missing_context_path_template": "/feedback/{slug}?kind=missing_context",
            },
        }

        config_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-config",
            json=config_payload,
        )
        get_config_resp = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/directory-config",
        )

        assert config_resp.status_code == STATUS_OK
        assert get_config_resp.status_code == STATUS_OK
        assert get_config_resp.json()["title"] == "Detroit tenant power directory"
        assert get_config_resp.json()["sponsor_label"] == "Supported by Detroit Housing Fund"
        assert get_config_resp.json()["scope"] == config_payload["scope"]
        assert get_config_resp.json()["methodology"] == config_payload["methodology"]

        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries", json=ENTRY_PAYLOAD
        )
        entry_id = create_resp.json()["id"]
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.test/detroit-directory-source",
            source_type="community_archive",
            extraction_method="manual",
            title="Detroit tenant directory source",
        )
        await SourceCRUD.link_to_entry(
            test_db,
            entry_id,
            source_id,
            "Source names Test Private Org as a tenant organizing actor.",
        )
        publish_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/{entry_id}/publish"
        )
        assert publish_resp.status_code == STATUS_OK

        directory_resp = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/public-directory"
        )

        assert directory_resp.status_code == STATUS_OK
        directory = directory_resp.json()
        assert directory["title"] == "Detroit tenant power directory"
        assert directory["sponsor_label"] == "Supported by Detroit Housing Fund"
        assert directory["scope"] == config_payload["scope"]
        assert directory["methodology"] == config_payload["methodology"]
        assert directory["stats"]["record_count"] == 1
        assert directory["stats"]["source_count"] == 1

    @pytest.mark.asyncio
    async def test_directory_config_requires_public_directory_capability(
        self, test_client: object
    ) -> None:
        """Directory configuration should belong to directory-capable packages."""
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-config",
            json={"title": "Detroit tenant power directory"},
        )

        assert response.status_code == STATUS_FORBIDDEN
        detail = response.json()["detail"]
        assert detail["error"] == "plan_required"
        assert detail["capability"] == "public.directories"

    @pytest.mark.asyncio
    async def test_verified_custom_domain_is_exposed_on_public_directory(
        self, directory_capable_client: object
    ) -> None:
        """Verified tenant domains should be visible on the public directory trust surface."""
        create_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED
        domain_payload = create_resp.json()
        assert domain_payload["domain"] == "guide.kctenants.org"
        assert domain_payload["status"] == "pending"
        assert domain_payload["verification_token"].startswith("atlas-verify=")

        verify_resp = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries/directory-domain/verify",
            json={"txt_record": domain_payload["verification_token"]},
        )
        assert verify_resp.status_code == STATUS_OK
        assert verify_resp.json()["status"] == "verified"

        directory_resp = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/public-directory"
        )
        assert directory_resp.status_code == STATUS_OK
        payload = directory_resp.json()
        assert payload["workspace"]["custom_domain"] == {
            "domain": "guide.kctenants.org",
            "status": "verified",
        }

    @pytest.mark.asyncio
    async def test_directory_domain_requires_public_directory_capability(
        self, test_client: object
    ) -> None:
        """Custom directory domains should be reserved for directory-capable packages."""
        response = await test_client.post(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )

        assert response.status_code == STATUS_FORBIDDEN
        detail = response.json()["detail"]
        assert detail["error"] == "plan_required"
        assert detail["capability"] == "public.directories"


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
