"""Tests for org-scoped public-directory endpoints."""

from __future__ import annotations

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import SourceCRUD
from tests.domains.catalog.org_resources_support import (
    ENTRY_PAYLOAD,
    ORG_ID,
    STATUS_CONFLICT,
    STATUS_CREATED,
    STATUS_FORBIDDEN,
    STATUS_OK,
)


class TestOrgEntriesPublicDirectory:
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
        assert detail["plan_required"] == "team"

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
