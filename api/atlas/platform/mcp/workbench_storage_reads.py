"""Workbench storage helpers for read and link validation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watches import OrgWatchCRUD, OrgWatchUpsert
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    import aiosqlite

    from .workbench_models import (
        CreateResearchBriefRequest,
        WatchResourceType,
        WatchWorkspaceResourceRequest,
    )


async def _resource_visible_to_org(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    resource_type: str,
    resource_id: str,
) -> bool:
    ownership = await OwnershipCRUD.get_ownership(db, resource_id, resource_type)
    return ownership is None or ownership.org_id == org_id


async def _entry_link_is_valid(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    entry_id: str,
) -> bool:
    return await EntryCRUD.get_by_id(db, entry_id) is not None and await _resource_visible_to_org(
        db, org_id=org_id, resource_type="entry", resource_id=entry_id
    )


async def _source_link_is_valid(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    source_id: str,
) -> bool:
    return await SourceCRUD.get_by_id(db, source_id) is not None and await _resource_visible_to_org(
        db, org_id=org_id, resource_type="source", resource_id=source_id
    )


async def _discovery_run_link_is_valid(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    run_id: str,
) -> bool:
    return await DiscoveryRunCRUD.get_by_id(
        db, run_id
    ) is not None and await _resource_visible_to_org(
        db, org_id=org_id, resource_type="discovery_run", resource_id=run_id
    )


async def _brief_links_are_valid(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    linked_entry_ids: list[str],
    linked_source_ids: list[str],
    linked_discovery_run_ids: list[str],
) -> bool:
    if not linked_entry_ids and not linked_source_ids and not linked_discovery_run_ids:
        return False

    for entry_id in linked_entry_ids:
        if not await _entry_link_is_valid(db, org_id=org_id, entry_id=entry_id):
            return False

    for source_id in linked_source_ids:
        if not await _source_link_is_valid(db, org_id=org_id, source_id=source_id):
            return False

    for run_id in linked_discovery_run_ids:
        if not await _discovery_run_link_is_valid(db, org_id=org_id, run_id=run_id):
            return False

    return True


async def _create_research_brief_with_db(
    db: aiosqlite.Connection,
    request: CreateResearchBriefRequest,
) -> dict[str, Any]:
    if not await _brief_links_are_valid(
        db,
        org_id=request.org_id,
        linked_entry_ids=request.linked_entry_ids,
        linked_source_ids=request.linked_source_ids,
        linked_discovery_run_ids=request.linked_discovery_run_ids,
    ):
        return {"status": "not_found", "message": "Brief evidence was not found."}

    brief = await OrgBriefCRUD.create(
        db,
        org_id=request.org_id,
        title=request.title,
        scope=request.scope,
        summary=request.summary,
        linked_entry_ids=request.linked_entry_ids,
        linked_source_ids=request.linked_source_ids,
        linked_discovery_run_ids=request.linked_discovery_run_ids,
        confidence_summary=request.confidence_summary,
        gaps=request.gaps,
        created_by=request.user_id,
    )
    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=request.org_id,
            actor_id=request.user_id,
            event_type="brief_opened",
            resource_type="brief",
            resource_id=brief.id,
        ),
    )
    return {
        "status": "created",
        "brief_id": brief.id,
        "title": brief.title,
        "linked_entry_ids": brief.linked_entry_ids,
        "linked_source_ids": brief.linked_source_ids,
        "linked_discovery_run_ids": brief.linked_discovery_run_ids,
        "visibility": request.confirmation.visibility,
    }


async def _watchable_resource_exists(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    resource_type: WatchResourceType,
    resource_id: str,
) -> bool:
    if resource_type == "entry":
        return await EntryCRUD.get_by_id(db, resource_id) is not None

    target = await CoverageTargetCRUD.get(db, resource_id)
    return target is not None and target.org_id == org_id


async def _watch_workspace_resource_with_db(
    db: aiosqlite.Connection,
    request: WatchWorkspaceResourceRequest,
) -> dict[str, Any]:
    if not await _watchable_resource_exists(
        db,
        org_id=request.org_id,
        resource_type=request.resource_type,
        resource_id=request.resource_id,
    ):
        return {"status": "not_found", "message": "Watch target not found."}

    existing = await OrgWatchCRUD.get(
        db,
        org_id=request.org_id,
        resource_type=request.resource_type,
        resource_id=request.resource_id,
    )
    watch = await OrgWatchCRUD.upsert(
        db,
        OrgWatchUpsert(
            org_id=request.org_id,
            resource_type=request.resource_type,
            resource_id=request.resource_id,
            created_by=request.user_id,
            notification_preference=request.confirmation.notification_preference,
        ),
    )
    if existing is None:
        await OrgUsageEventCRUD.record(
            db,
            OrgUsageEventRecord(
                org_id=request.org_id,
                actor_id=request.user_id,
                event_type="watch_created",
                resource_type="watch",
                resource_id=watch.id,
            ),
        )

    return {
        "status": "watched",
        "watch_id": watch.id,
        "resource_type": watch.resource_type,
        "resource_id": watch.resource_id,
        "notification_preference": watch.notification_preference,
    }
