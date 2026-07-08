"""Workbench storage helpers for write operations."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas_shared import DiscoveryRunSyncRequest
from fastapi import Response

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.api import sync_discovery_run
from atlas.domains.discovery.api_org_coverage import build_coverage_report_response
from atlas.domains.discovery.briefs import OrgBriefCRUD, OrgBriefModel
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.models import EntryCRUD
from atlas.taxonomy.issue_areas import ALL_ISSUE_SLUGS

if TYPE_CHECKING:
    import aiosqlite

    from .workbench_models import (
        CreateCoverageTargetRequest,
        ExportCoverageReportRequest,
        ExportResearchBriefRequest,
        SaveEntitiesToListRequest,
        SyncScoutArtifactsRequest,
    )


async def _save_entities_to_list_with_db(
    db: aiosqlite.Connection,
    request: SaveEntitiesToListRequest,
) -> dict[str, Any]:
    list_record = await SavedListCRUD.get_by_id(db, request.list_id)
    if list_record is None or list_record.user_id != request.user_id:
        return {"status": "not_found", "message": "List not found."}

    saved_entry_ids: list[str] = []
    for entry_id in dict.fromkeys(request.entry_ids):
        entry = await EntryCRUD.get_by_id(db, entry_id)
        if entry is None:
            continue
        await SavedListCRUD.add_item(
            db, list_id=request.list_id, entry_id=entry_id, note=request.note
        )
        saved_entry_ids.append(entry_id)
        if request.org_id is not None:
            await OrgUsageEventCRUD.record(
                db,
                OrgUsageEventRecord(
                    org_id=request.org_id,
                    actor_id=request.user_id,
                    event_type="list_item_saved",
                    resource_type="saved_list",
                    resource_id=request.list_id,
                ),
            )

    return {
        "status": "saved",
        "list_id": request.list_id,
        "saved_count": len(saved_entry_ids),
        "entry_ids": saved_entry_ids,
        "visibility": request.confirmation.visibility,
    }


async def _coverage_target_links_are_valid(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    issue_areas: list[str],
    linked_discovery_run_ids: list[str],
    linked_entry_ids: list[str],
) -> bool:
    if any(issue_area not in ALL_ISSUE_SLUGS for issue_area in issue_areas):
        return False

    for run_id in linked_discovery_run_ids:
        ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
        if ownership is None or ownership.org_id != org_id:
            return False

    for entry_id in linked_entry_ids:
        if await EntryCRUD.get_by_id(db, entry_id) is None:
            return False

    return True


async def _create_coverage_target_with_db(
    db: aiosqlite.Connection,
    request: CreateCoverageTargetRequest,
) -> dict[str, Any]:
    if not await _coverage_target_links_are_valid(
        db,
        org_id=request.org_id,
        issue_areas=request.issue_areas,
        linked_discovery_run_ids=request.linked_discovery_run_ids,
        linked_entry_ids=request.linked_entry_ids,
    ):
        return {"status": "not_found", "message": "Coverage target evidence was not found."}

    target = await CoverageTargetCRUD.create(
        db,
        org_id=request.org_id,
        name=request.name,
        geography=request.geography,
        issue_areas=request.issue_areas,
        actor_types=request.actor_types,
        source_types=request.source_types,
        gaps=request.gaps,
        next_actions=request.next_actions,
        linked_discovery_run_ids=request.linked_discovery_run_ids,
        linked_entry_ids=request.linked_entry_ids,
        created_by=request.user_id,
        review_state=request.confirmation.review_state,
    )
    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=request.org_id,
            actor_id=request.user_id,
            event_type="coverage_target_created",
            resource_type="coverage_target",
            resource_id=target.id,
        ),
    )
    return {
        "status": "created",
        "target_id": target.id,
        "name": target.name,
        "geography": target.geography,
        "issue_areas": target.issue_areas,
        "actor_types": target.actor_types,
        "source_types": target.source_types,
        "review_state": target.review_state,
        "coverage_status": target.status,
        "linked_entry_ids": target.linked_entry_ids,
        "linked_discovery_run_ids": target.linked_discovery_run_ids,
        "visibility": request.confirmation.visibility,
    }


def _brief_export_payload(brief: OrgBriefModel) -> dict[str, Any]:
    linked_entry_ids = list(brief.linked_entry_ids)
    linked_source_ids = list(brief.linked_source_ids)
    linked_discovery_run_ids = list(brief.linked_discovery_run_ids)
    confidence_summary = dict(brief.confidence_summary)
    gaps = list(brief.gaps)
    return {
        "status": "exported",
        "format": "json",
        "brief": {
            "id": brief.id,
            "org_id": brief.org_id,
            "title": brief.title,
            "scope": dict(brief.scope),
            "summary": brief.summary,
            "linked_entry_ids": linked_entry_ids,
            "linked_source_ids": linked_source_ids,
            "linked_discovery_run_ids": linked_discovery_run_ids,
            "confidence_summary": confidence_summary,
            "gaps": gaps,
            "created_by": brief.created_by,
            "created_at": brief.created_at,
            "updated_at": brief.updated_at,
        },
        "provenance": {
            "source_count": len(linked_source_ids),
            "entry_count": len(linked_entry_ids),
            "discovery_run_count": len(linked_discovery_run_ids),
            "confidence_state": confidence_summary.get("state", "unverified"),
            "review_status": confidence_summary.get("review_status", "operator_review_required"),
        },
    }


async def _export_research_brief_with_db(
    db: aiosqlite.Connection,
    request: ExportResearchBriefRequest,
) -> dict[str, Any]:
    brief = await OrgBriefCRUD.get(db, request.brief_id)
    if brief is None or brief.org_id != request.org_id:
        return {"status": "not_found", "message": "Brief not found."}

    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=request.org_id,
            actor_id=request.user_id,
            event_type="brief_exported",
            resource_type="brief",
            resource_id=brief.id,
        ),
    )
    return _brief_export_payload(brief)


async def _export_coverage_report_with_db(
    db: aiosqlite.Connection,
    request: ExportCoverageReportRequest,
) -> dict[str, Any]:
    targets = await CoverageTargetCRUD.list_by_org(db, request.org_id)
    report = build_coverage_report_response(org_id=request.org_id, targets=targets)
    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=request.org_id,
            actor_id=request.user_id,
            event_type="coverage_report_exported",
            resource_type="coverage_report",
            resource_id=request.org_id,
        ),
    )
    return {
        "status": "exported",
        "format": request.confirmation.format,
        "report": report.model_dump(mode="json"),
    }


async def _sync_scout_artifacts_with_db(
    db: aiosqlite.Connection,
    request: SyncScoutArtifactsRequest,
) -> dict[str, Any]:
    response = await sync_discovery_run(
        DiscoveryRunSyncRequest(artifacts=request.artifacts),
        response=Response(),
        actor=AuthenticatedActor(
            user_id=request.user_id,
            email=request.user_id,
            auth_type="mcp",
            org_id=request.org_id,
        ),
        db=db,
        x_atlas_upload_target="workspace",
        x_atlas_workspace_id=request.org_id,
    )
    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=request.org_id,
            actor_id=request.user_id,
            event_type="scout_artifacts_synced",
            resource_type="discovery_run",
            resource_id=response.run_id,
        ),
    )
    payload = response.model_dump(mode="json")
    run_status = payload.pop("status")
    return {
        "status": "synced",
        "visibility": request.confirmation.visibility,
        "run_status": run_status,
        **payload,
    }
