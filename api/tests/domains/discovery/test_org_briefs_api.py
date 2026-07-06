"""Tests for org-scoped Atlas Brief artifacts."""
# ruff: noqa

from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_actor, require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import (
    OrgBriefCRUD,
    StoredBriefDecodeError,
    _decode_json_object,
    _decode_json_object_list,
    _decode_json_string_list,
)
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_BAD_REQUEST = 400
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404

ORG_ID = "local"
OTHER_ORG_ID = "other-org"


@pytest_asyncio.fixture
async def capable_test_client(test_settings: Settings) -> object:
    """Test client whose local actor can create workspace brief artifacts."""
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
            capabilities=frozenset({"research.run", "workspace.export"}),
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
async def limited_test_client(test_settings: Settings) -> object:
    """Test client whose actor lacks paid workspace export capability."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        actor = AuthenticatedActor(
            user_id="limited-user",
            email="limited@atlas.rebuildingus.org",
            auth_type="oauth_jwt",
            org_id=ORG_ID,
        )
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


async def _create_linked_records(test_db: object) -> tuple[str, str, str]:
    """Create one entry, source, and discovery run that can anchor a brief."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Kansas City Tenant Union",
        description="A source-backed housing organization.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/kc-tenant-union",
        source_type="community_archive",
        extraction_method="manual",
        title="Kansas City Tenant Union profile",
    )
    await SourceCRUD.link_to_entry(
        test_db,
        entry_id,
        source_id,
        "Source names the organization and its housing work.",
    )
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="landscape_scan",
    )
    return entry_id, source_id, run_id


def _brief_payload(entry_id: str, source_id: str, run_id: str) -> dict[str, object]:
    """Return a complete create payload for a workspace brief."""
    return {
        "title": "Kansas City housing landscape brief",
        "scope": {
            "geography": "Kansas City, MO",
            "issue_areas": ["housing_affordability"],
            "actor_types": ["organization"],
            "source_types": ["community_archive"],
        },
        "summary": "One source-backed housing lead is ready for review.",
        "linked_entry_ids": [entry_id],
        "linked_source_ids": [source_id],
        "linked_discovery_run_ids": [run_id],
        "confidence_summary": {
            "state": "partial",
            "source_count": 1,
            "review_status": "operator_review_required",
        },
        "gaps": [
            {
                "label": "County coverage",
                "detail": "No county-level tenant source has been reviewed yet.",
            }
        ],
    }


class TestOrgBriefsSchema:
    """Schema coverage for private workspace brief artifacts."""

    @pytest.mark.asyncio
    async def test_init_db_creates_org_briefs_table(self, test_db: object) -> None:
        """Fresh databases should include durable workspace brief artifact columns."""
        cursor = await test_db.execute("PRAGMA table_info(org_briefs)")
        columns = {row[1] for row in await cursor.fetchall()}

        assert {
            "id",
            "org_id",
            "title",
            "scope_json",
            "summary",
            "linked_entry_ids_json",
            "linked_source_ids_json",
            "linked_discovery_run_ids_json",
            "confidence_summary_json",
            "gaps_json",
            "created_by",
            "created_at",
            "updated_at",
        }.issubset(columns)

    def test_stored_brief_decode_guards_reject_unexpected_shapes(self) -> None:
        """Corrupt persisted brief JSON should fail before it can become trusted output."""
        with pytest.raises(StoredBriefDecodeError):
            _decode_json_object('["not", "an", "object"]')

        with pytest.raises(StoredBriefDecodeError):
            _decode_json_string_list('["valid", 42]')

        with pytest.raises(StoredBriefDecodeError):
            _decode_json_object_list('[{"label": "ok"}, "not-object"]')

    @pytest.mark.asyncio
    async def test_update_returns_existing_brief_when_no_fields_are_sent(
        self,
        test_db: object,
    ) -> None:
        """Omitting every editable field should leave the stored brief untouched."""
        brief = await OrgBriefCRUD.create(
            test_db,
            org_id=ORG_ID,
            title="Kansas City housing landscape brief",
            scope={"geography": "Kansas City, MO"},
            summary="One source-backed housing lead is ready for review.",
            linked_entry_ids=[],
            linked_source_ids=[],
            linked_discovery_run_ids=[],
            confidence_summary={},
            gaps=[],
            created_by="local-user",
        )

        updated = await OrgBriefCRUD.update(test_db, brief.id)

        assert updated is not None
        assert updated.id == brief.id

    @pytest.mark.asyncio
    async def test_update_returns_none_for_missing_brief(self, test_db: object) -> None:
        """Missing briefs should stay missing during updates."""
        assert await OrgBriefCRUD.update(test_db, "missing-brief") is None

    @pytest.mark.asyncio
    async def test_update_returns_none_when_a_missing_brief_is_changed(
        self,
        test_db: object,
    ) -> None:
        """Updating a missing brief with fields should still fail cleanly."""
        assert (
            await OrgBriefCRUD.update(
                test_db,
                "missing-brief",
                title="Updated title",
            )
            is None
        )


class TestOrgBriefsApi:
    """Org-scoped brief artifact behavior."""

    @pytest.mark.asyncio
    async def test_list_returns_empty_initially(self, test_client: object) -> None:
        """A workspace with no briefs should receive an empty collection."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs")

        assert response.status_code == STATUS_OK
        assert response.json() == {"items": [], "total": 0}

    @pytest.mark.asyncio
    async def test_create_and_list_brief(
        self, capable_test_client: object, test_client: object, test_db: object
    ) -> None:
        """A private Atlas Brief should persist and appear in the workspace list."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        payload = _brief_payload(entry_id, source_id, run_id)

        create_response = await capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

        assert create_response.status_code == STATUS_CREATED
        created = create_response.json()
        assert created["org_id"] == ORG_ID
        assert created["title"] == payload["title"]
        assert created["scope"] == payload["scope"]
        assert created["summary"] == payload["summary"]
        assert created["linked_entry_ids"] == [entry_id]
        assert created["linked_source_ids"] == [source_id]
        assert created["linked_discovery_run_ids"] == [run_id]
        assert created["confidence_summary"] == payload["confidence_summary"]
        assert created["gaps"] == payload["gaps"]
        assert created["created_by"] == "local-user"
        assert created["created_at"]
        assert created["updated_at"]

        list_response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs")
        assert list_response.status_code == STATUS_OK
        listed = list_response.json()
        assert listed["total"] == 1
        assert listed["items"][0]["id"] == created["id"]
        assert listed["items"][0]["title"] == payload["title"]

    @pytest.mark.asyncio
    async def test_get_brief(
        self, capable_test_client: object, test_client: object, test_db: object
    ) -> None:
        """A workspace should be able to reload one of its private briefs."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        get_response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs/{brief_id}")

        assert get_response.status_code == STATUS_OK
        assert get_response.json()["id"] == brief_id
        assert await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID) == {"brief_opened": 1}

    @pytest.mark.asyncio
    async def test_update_brief_reports_missing_brief(self, capable_test_client: object) -> None:
        """Updates should fail plainly when the brief no longer exists."""
        response = await capable_test_client.patch(
            f"/api/orgs/{ORG_ID}/briefs/missing",
            json={},
        )

        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_brief_requires_fields(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Blank updates should be rejected before they reach persistence."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        response = await capable_test_client.patch(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}",
            json={},
        )

        assert response.status_code == STATUS_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_update_brief_reports_missing_after_persistence(
        self,
        capable_test_client: object,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """If the update disappears mid-write, the route should fail closed."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        monkeypatch.setattr(OrgBriefCRUD, "update", AsyncMock(return_value=None))

        response = await capable_test_client.patch(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}",
            json={"title": "Updated title"},
        )

        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_export_brief_preserves_sources_and_linked_actor_context(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Brief exports should carry the brief, source receipts, and linked actors."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        export_response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export"
        )

        assert export_response.status_code == STATUS_OK
        assert await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID) == {
            "brief_exported": 1
        }
        payload = export_response.json()
        assert payload["format"] == "json"
        assert payload["brief"]["id"] == brief_id
        assert payload["brief"]["linked_entry_ids"] == [entry_id]
        assert payload["entries"] == [
            {
                "id": entry_id,
                "name": "Kansas City Tenant Union",
                "type": "organization",
                "city": "Kansas City",
                "state": "MO",
            }
        ]
        assert payload["sources"] == [
            {
                "id": source_id,
                "url": "https://example.test/kc-tenant-union",
                "title": "Kansas City Tenant Union profile",
                "publication": None,
                "published_date": None,
                "type": "community_archive",
                "ingested_at": payload["sources"][0]["ingested_at"],
            }
        ]
        assert payload["discovery_runs"] == [
            {
                "id": run_id,
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["housing_affordability"],
                "research_goal": "landscape_scan",
                "status": "running",
            }
        ]
        assert payload["provenance"] == {
            "source_count": 1,
            "entry_count": 1,
            "discovery_run_count": 1,
            "confidence_state": "partial",
            "review_status": "operator_review_required",
        }

    @pytest.mark.asyncio
    async def test_export_brief_as_csv_preserves_meeting_ready_evidence(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """CSV exports should carry brief, actor, source, run, gap, and provenance rows."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        export_response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export?format=csv"
        )

        assert export_response.status_code == STATUS_OK
        assert export_response.headers["content-type"].startswith("text/csv")
        assert export_response.headers["content-disposition"] == (
            f'attachment; filename="kansas-city-housing-landscape-brief-{brief_id}.csv"'
        )
        rows = list(csv.DictReader(io.StringIO(export_response.text)))
        rows_by_type = {row["row_type"]: row for row in rows}

        assert rows_by_type["brief"]["record_id"] == brief_id
        assert rows_by_type["brief"]["title"] == "Kansas City housing landscape brief"
        assert (
            rows_by_type["brief"]["detail"] == "One source-backed housing lead is ready for review."
        )
        assert rows_by_type["entry"]["record_id"] == entry_id
        assert rows_by_type["entry"]["name"] == "Kansas City Tenant Union"
        assert rows_by_type["source"]["record_id"] == source_id
        assert rows_by_type["source"]["url"] == "https://example.test/kc-tenant-union"
        assert rows_by_type["discovery_run"]["record_id"] == run_id
        assert rows_by_type["discovery_run"]["location"] == "Kansas City, MO"
        assert rows_by_type["gap"]["title"] == "County coverage"
        assert rows_by_type["provenance"]["source_count"] == "1"
        assert rows_by_type["provenance"]["confidence_state"] == "partial"

    @pytest.mark.asyncio
    async def test_update_brief_memo_fields_preserves_linked_evidence(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A reviewed brief should be editable without dropping source-linked context."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        update_payload = {
            "title": "Reviewed Kansas City housing brief",
            "summary": "Reviewed summary with clearer sourcing and follow-up judgment.",
            "confidence_summary": {
                "state": "corroborated",
                "source_count": 1,
                "review_status": "reviewed by research",
            },
            "gaps": [
                {
                    "label": "County organizers",
                    "detail": "Confirm county-level organizing before regional outreach.",
                }
            ],
        }
        update_response = await capable_test_client.patch(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}",
            json=update_payload,
        )

        assert update_response.status_code == STATUS_OK
        updated = update_response.json()
        assert updated["title"] == update_payload["title"]
        assert updated["summary"] == update_payload["summary"]
        assert updated["confidence_summary"] == update_payload["confidence_summary"]
        assert updated["gaps"] == update_payload["gaps"]
        assert updated["linked_entry_ids"] == [entry_id]
        assert updated["linked_source_ids"] == [source_id]
        assert updated["linked_discovery_run_ids"] == [run_id]

        export_response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export"
        )
        exported = export_response.json()
        assert exported["brief"]["title"] == update_payload["title"]
        assert exported["brief"]["summary"] == update_payload["summary"]
        assert exported["provenance"]["confidence_state"] == "corroborated"
        assert exported["provenance"]["review_status"] == "reviewed by research"
        assert exported["entries"][0]["id"] == entry_id
        assert exported["sources"][0]["id"] == source_id

    @pytest.mark.asyncio
    async def test_export_omits_deleted_linked_context(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Exports should avoid inventing context when linked records have disappeared."""
        brief = await OrgBriefCRUD.create(
            test_db,
            org_id=ORG_ID,
            title="Deleted context brief",
            scope={
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
            },
            summary="A brief with stale links.",
            linked_entry_ids=["missing-entry"],
            linked_source_ids=["missing-source"],
            linked_discovery_run_ids=["missing-run"],
            confidence_summary={
                "state": "unverified",
                "source_count": 0,
                "review_status": "operator_review_required",
            },
            gaps=[],
            created_by="local-user",
        )

        export_response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/briefs/{brief.id}/export"
        )

        assert export_response.status_code == STATUS_OK
        payload = export_response.json()
        assert payload["entries"] == []
        assert payload["sources"] == []
        assert payload["discovery_runs"] == []
        assert payload["provenance"] == {
            "source_count": 0,
            "entry_count": 0,
            "discovery_run_count": 0,
            "confidence_state": "unverified",
            "review_status": "operator_review_required",
        }

    @pytest.mark.asyncio
    async def test_export_requires_workspace_export_capability(
        self, capable_test_client: object, limited_test_client: object, test_db: object
    ) -> None:
        """Brief exports should stay behind the paid export capability."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/briefs",
            json=_brief_payload(entry_id, source_id, run_id),
        )
        brief_id = create_response.json()["id"]

        export_response = await limited_test_client.get(
            f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export"
        )

        assert export_response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_wrong_org_is_rejected(self, test_client: object) -> None:
        """Brief endpoints should enforce the actor's workspace boundary."""
        response = await test_client.get(f"/api/orgs/{OTHER_ORG_ID}/briefs")

        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_create_rejects_unknown_source_link(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A brief cannot claim a source receipt that does not exist."""
        entry_id, _source_id, run_id = await _create_linked_records(test_db)
        payload = _brief_payload(entry_id, "missing-source", run_id)

        response = await capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

        assert response.status_code == STATUS_NOT_FOUND
        assert response.json()["detail"] == "Source not found"

    @pytest.mark.asyncio
    async def test_create_rejects_unknown_entry_link(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A brief cannot claim an actor that does not exist."""
        _entry_id, source_id, run_id = await _create_linked_records(test_db)
        payload = _brief_payload("missing-entry", source_id, run_id)

        response = await capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

        assert response.status_code == STATUS_NOT_FOUND
        assert response.json()["detail"] == "Entry not found"

    @pytest.mark.asyncio
    async def test_create_rejects_unknown_discovery_run_link(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A brief cannot claim research context that does not exist."""
        entry_id, source_id, _run_id = await _create_linked_records(test_db)
        payload = _brief_payload(entry_id, source_id, "missing-run")

        response = await capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

        assert response.status_code == STATUS_NOT_FOUND
        assert response.json()["detail"] == "Discovery run not found"

    @pytest.mark.asyncio
    async def test_create_rejects_resource_owned_by_another_workspace(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Workspace briefs cannot launder another workspace's private actor context."""
        entry_id, source_id, run_id = await _create_linked_records(test_db)
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id=entry_id,
            resource_type="entry",
            org_id=OTHER_ORG_ID,
            visibility="private",
            created_by="other-user",
        )
        payload = _brief_payload(entry_id, source_id, run_id)

        response = await capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

        assert response.status_code == STATUS_NOT_FOUND
        assert response.json()["detail"] == "Entry not found"

    @pytest.mark.asyncio
    async def test_get_unknown_brief_returns_not_found(self, test_client: object) -> None:
        """Unknown private brief IDs should not expose workspace artifact details."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs/missing-brief")

        assert response.status_code == STATUS_NOT_FOUND
        assert response.json()["detail"] == "Brief not found"

    @pytest.mark.asyncio
    async def test_export_unknown_brief_returns_not_found(
        self, capable_test_client: object
    ) -> None:
        """Unknown brief exports should fail with the same private-artifact boundary."""
        response = await capable_test_client.get(f"/api/orgs/{ORG_ID}/briefs/missing-brief/export")

        assert response.status_code == STATUS_NOT_FOUND
        assert response.json()["detail"] == "Brief not found"

    @pytest.mark.asyncio
    async def test_create_rejects_empty_evidence_links(self, capable_test_client: object) -> None:
        """A sellable brief needs at least one linked entity, source, or run."""
        payload = _brief_payload("entry-id", "source-id", "run-id")
        payload["linked_entry_ids"] = []
        payload["linked_source_ids"] = []
        payload["linked_discovery_run_ids"] = []

        response = await capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

        assert response.status_code == STATUS_BAD_REQUEST
        assert response.json()["detail"] == (
            "At least one linked entry, source, or discovery run is required."
        )
