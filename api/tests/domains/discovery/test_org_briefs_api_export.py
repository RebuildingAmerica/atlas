"""Org brief export behavior tests."""
# ruff: noqa

from __future__ import annotations

import csv
import io

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD

from tests.domains.discovery.org_briefs_support import (
    ORG_ID,
    OTHER_ORG_ID,
    _brief_payload,
    _create_linked_records,
)


@pytest.mark.asyncio
async def test_export_brief_preserves_sources_and_linked_actor_context(
    briefs_capable_test_client: object, test_db: object
) -> None:
    """Brief exports should carry the brief, source receipts, and linked actors."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs",
        json=_brief_payload(entry_id, source_id, run_id),
    )
    brief_id = create_response.json()["id"]

    export_response = await briefs_capable_test_client.get(
        f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export"
    )

    assert export_response.status_code == 200
    assert await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID) == {"brief_exported": 1}
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
    briefs_capable_test_client: object, test_db: object
) -> None:
    """CSV exports should carry brief, actor, source, run, gap, and provenance rows."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs",
        json=_brief_payload(entry_id, source_id, run_id),
    )
    brief_id = create_response.json()["id"]

    export_response = await briefs_capable_test_client.get(
        f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export?format=csv"
    )

    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("text/csv")
    assert export_response.headers["content-disposition"] == (
        f'attachment; filename="kansas-city-housing-landscape-brief-{brief_id}.csv"'
    )
    rows = list(csv.DictReader(io.StringIO(export_response.text)))
    rows_by_type = {row["row_type"]: row for row in rows}

    assert rows_by_type["brief"]["record_id"] == brief_id
    assert rows_by_type["brief"]["title"] == "Kansas City housing landscape brief"
    assert rows_by_type["brief"]["detail"] == "One source-backed housing lead is ready for review."
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
    briefs_capable_test_client: object, test_db: object
) -> None:
    """A reviewed brief should be editable without dropping source-linked context."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
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
    update_response = await briefs_capable_test_client.patch(
        f"/api/orgs/{ORG_ID}/briefs/{brief_id}",
        json=update_payload,
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == update_payload["title"]
    assert updated["summary"] == update_payload["summary"]
    assert updated["confidence_summary"] == update_payload["confidence_summary"]
    assert updated["gaps"] == update_payload["gaps"]
    assert updated["linked_entry_ids"] == [entry_id]
    assert updated["linked_source_ids"] == [source_id]
    assert updated["linked_discovery_run_ids"] == [run_id]

    export_response = await briefs_capable_test_client.get(
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
    briefs_capable_test_client: object, test_db: object
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

    export_response = await briefs_capable_test_client.get(
        f"/api/orgs/{ORG_ID}/briefs/{brief.id}/export"
    )

    assert export_response.status_code == 200
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
    briefs_capable_test_client: object, briefs_limited_test_client: object, test_db: object
) -> None:
    """Brief exports should stay behind the paid export capability."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs",
        json=_brief_payload(entry_id, source_id, run_id),
    )
    brief_id = create_response.json()["id"]

    export_response = await briefs_limited_test_client.get(
        f"/api/orgs/{ORG_ID}/briefs/{brief_id}/export"
    )

    assert export_response.status_code == 403


@pytest.mark.asyncio
async def test_wrong_org_is_rejected(test_client: object) -> None:
    """Brief endpoints should enforce the actor's workspace boundary."""
    response = await test_client.get(f"/api/orgs/{OTHER_ORG_ID}/briefs")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_export_unknown_brief_returns_not_found(
    briefs_capable_test_client: object,
) -> None:
    """Unknown brief exports should fail with the same private-artifact boundary."""
    response = await briefs_capable_test_client.get(
        f"/api/orgs/{ORG_ID}/briefs/missing-brief/export"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Brief not found"
