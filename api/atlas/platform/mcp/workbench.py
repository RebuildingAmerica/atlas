"""MCP Workbench write handoffs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from atlas_shared import DiscoveryRunArtifacts, DiscoveryRunSyncRequest
from fastapi import Response
from pydantic import BaseModel, ConfigDict, Field

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watches import (
    OrgWatchCRUD,
    OrgWatchUpsert,
    WatchNotificationPreference,
    WatchResourceType,
)
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.api import sync_discovery_run
from atlas.domains.discovery.api_org_coverage import build_coverage_report_response
from atlas.domains.discovery.briefs import OrgBriefCRUD, OrgBriefModel
from atlas.domains.discovery.coverage_targets import (
    CoverageReviewState,
    CoverageTargetCRUD,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD
from atlas.platform.config import get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.mcp.auth_middleware import _string_claim
from atlas.platform.mcp.elicitation import declares_form_elicitation, log_elicitation_event
from atlas.taxonomy.issue_areas import ALL_ISSUE_SLUGS

if TYPE_CHECKING:
    import aiosqlite

WorkbenchStopAction = Literal["decline", "cancel"]

__all__ = [
    "CreateCoverageTargetConfirmation",
    "CreateResearchBriefConfirmation",
    "ExportCoverageReportConfirmation",
    "ExportResearchBriefConfirmation",
    "SaveEntitiesToListConfirmation",
    "SyncScoutArtifactsConfirmation",
    "WatchWorkspaceResourceConfirmation",
    "create_coverage_target",
    "create_research_brief",
    "export_coverage_report",
    "export_research_brief",
    "save_entities_to_list",
    "sync_scout_artifacts",
    "watch_workspace_resource",
]


class SaveEntitiesToListConfirmation(BaseModel):
    """Form confirmation before saving source-linked actors to a list."""

    model_config = ConfigDict(extra="forbid")

    confirm_save: bool = Field(
        title="Save actors",
        description="Confirm saving the selected actors to this private list.",
    )
    visibility: Literal["private"] = Field(
        default="private",
        title="Visibility",
        description="Saved lists are private to your Atlas account.",
    )
    source_linkage_ack: bool = Field(
        default=True,
        title="Keep sources attached",
        description="Keep source links available through the saved-list export.",
    )


class WatchWorkspaceResourceConfirmation(BaseModel):
    """Form confirmation before watching a workspace resource."""

    model_config = ConfigDict(extra="forbid")

    confirm_watch: bool = Field(
        title="Watch resource",
        description="Confirm watching this Atlas workspace resource.",
    )
    notification_preference: WatchNotificationPreference = Field(
        default="digest",
        title="Notifications",
        description="How Atlas should notify this workspace.",
    )


class CreateCoverageTargetConfirmation(BaseModel):
    """Form confirmation before creating a workspace coverage target."""

    model_config = ConfigDict(extra="forbid")

    confirm_create: bool = Field(
        title="Create coverage target",
        description="Confirm creating this private workspace coverage target.",
    )
    visibility: Literal["workspace"] = Field(
        default="workspace",
        title="Visibility",
        description="Coverage targets are private to the active workspace.",
    )
    review_state: CoverageReviewState = Field(
        default="needs_research",
        title="Review state",
        description="How this target should enter the workspace review queue.",
    )
    source_linkage_ack: bool = Field(
        default=True,
        title="Keep evidence attached",
        description="Keep linked discovery runs and actors attached to the target.",
    )


class CreateResearchBriefConfirmation(BaseModel):
    """Form confirmation before creating a private workspace brief."""

    model_config = ConfigDict(extra="forbid")

    confirm_create: bool = Field(
        title="Create brief",
        description="Confirm creating this private workspace brief.",
    )
    visibility: Literal["workspace"] = Field(
        default="workspace",
        title="Visibility",
        description="Briefs are private to the active Atlas workspace.",
    )
    source_linkage_ack: bool = Field(
        default=True,
        title="Keep evidence attached",
        description="Keep linked actors, sources, and discovery runs attached to the brief.",
    )


class ExportResearchBriefConfirmation(BaseModel):
    """Form confirmation before exporting a private workspace brief."""

    model_config = ConfigDict(extra="forbid")

    confirm_export: bool = Field(
        title="Export brief",
        description="Confirm exporting this private workspace brief.",
    )
    format: Literal["json"] = Field(
        default="json",
        title="Format",
        description="Export the brief as structured JSON.",
    )
    source_linkage_ack: bool = Field(
        default=True,
        title="Keep evidence attached",
        description="Keep linked actors, sources, and discovery runs in the export.",
    )


class ExportCoverageReportConfirmation(BaseModel):
    """Form confirmation before exporting a private workspace coverage report."""

    model_config = ConfigDict(extra="forbid")

    confirm_export: bool = Field(
        title="Export coverage report",
        description="Confirm exporting this private workspace coverage report.",
    )
    format: Literal["json"] = Field(
        default="json",
        title="Format",
        description="Export the coverage report as structured JSON.",
    )
    source_linkage_ack: bool = Field(
        default=True,
        title="Keep evidence attached",
        description="Keep target links, evidence counts, gaps, and next actions in the report.",
    )


class SyncScoutArtifactsConfirmation(BaseModel):
    """Form confirmation before syncing reviewed Scout artifacts."""

    model_config = ConfigDict(extra="forbid")

    confirm_sync: bool = Field(
        title="Sync Scout artifacts",
        description="Confirm syncing this reviewed Scout run to the active Atlas workspace.",
    )
    visibility: Literal["workspace"] = Field(
        default="workspace",
        title="Visibility",
        description="Synced Scout artifacts stay private to the active workspace.",
    )
    review_state: Literal["reviewed"] = Field(
        default="reviewed",
        title="Review state",
        description="Confirm the Scout artifact has been reviewed before syncing.",
    )
    source_linkage_ack: bool = Field(
        default=True,
        title="Keep sources attached",
        description="Keep source URLs, entry receipts, and run provenance attached.",
    )


class WorkbenchElicitationContext(Protocol):
    """Small context subset needed for MCP Workbench writes."""

    @property
    def request_context(self) -> Any:
        """Return the active MCP request context."""

    async def elicit(
        self,
        *,
        message: str,
        schema: type[BaseModel],
    ) -> Any:
        """Ask the MCP client for structured user confirmation."""


@dataclass(frozen=True)
class SaveEntitiesToListRequest:
    """Validated inputs for saving entries into a list."""

    user_id: str
    org_id: str | None
    list_id: str
    entry_ids: list[str]
    note: str | None
    confirmation: SaveEntitiesToListConfirmation


@dataclass(frozen=True)
class WatchWorkspaceResourceRequest:
    """Validated inputs for creating or updating a workspace watch."""

    user_id: str
    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    notification_preference: WatchNotificationPreference
    confirmation: WatchWorkspaceResourceConfirmation


@dataclass(frozen=True)
class CreateCoverageTargetRequest:
    """Validated inputs for creating a workspace coverage target."""

    user_id: str
    org_id: str
    name: str
    geography: str
    issue_areas: list[str]
    actor_types: list[str]
    source_types: list[str]
    linked_discovery_run_ids: list[str]
    linked_entry_ids: list[str]
    gaps: list[dict[str, str]]
    next_actions: list[str]
    confirmation: CreateCoverageTargetConfirmation


@dataclass(frozen=True)
class CreateResearchBriefRequest:
    """Validated inputs for creating a private workspace brief."""

    user_id: str
    org_id: str
    title: str
    scope: dict[str, Any]
    summary: str
    linked_entry_ids: list[str]
    linked_source_ids: list[str]
    linked_discovery_run_ids: list[str]
    confidence_summary: dict[str, Any]
    gaps: list[dict[str, Any]]
    confirmation: CreateResearchBriefConfirmation


@dataclass(frozen=True)
class ExportResearchBriefRequest:
    """Validated inputs for exporting a private workspace brief."""

    user_id: str
    org_id: str
    brief_id: str
    confirmation: ExportResearchBriefConfirmation


@dataclass(frozen=True)
class ExportCoverageReportRequest:
    """Validated inputs for exporting a private workspace coverage report."""

    user_id: str
    org_id: str
    confirmation: ExportCoverageReportConfirmation


@dataclass(frozen=True)
class SyncScoutArtifactsRequest:
    """Validated inputs for syncing reviewed Scout artifacts into a workspace."""

    user_id: str
    org_id: str
    artifacts: DiscoveryRunArtifacts
    confirmation: SyncScoutArtifactsConfirmation


def _stop_action(action: object) -> WorkbenchStopAction:
    return "cancel" if action == "cancel" else "decline"


def _request_meta_from_context(ctx: WorkbenchElicitationContext | None) -> object | None:
    if ctx is None:
        return None
    try:
        return cast("object | None", ctx.request_context.meta)
    except ValueError:
        return None


def _actor_claims_from_context(
    ctx: WorkbenchElicitationContext | None,
) -> tuple[str | None, str | None]:
    if ctx is None:
        return None, None
    try:
        request = ctx.request_context.request
    except ValueError:
        return None, None
    payload = getattr(request.state, "mcp_auth_payload", None) if request is not None else None
    return _string_claim(payload, "sub"), _string_claim(payload, "org_id")


async def _confirm_saved_list_write(
    ctx: WorkbenchElicitationContext,
) -> tuple[SaveEntitiesToListConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_save_list",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm saving these source-linked actors to your Atlas list.",
        schema=SaveEntitiesToListConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_save_list",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("SaveEntitiesToListConfirmation", result.data)
    if not confirmation.confirm_save:
        await log_elicitation_event(
            interaction="workbench_save_list",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_save_list",
        mode="form",
        action="accept",
    )
    return confirmation, None


async def _confirm_workspace_watch(
    ctx: WorkbenchElicitationContext,
) -> tuple[WatchWorkspaceResourceConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_watch_resource",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm watching this Atlas workspace resource.",
        schema=WatchWorkspaceResourceConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_watch_resource",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("WatchWorkspaceResourceConfirmation", result.data)
    if not confirmation.confirm_watch:
        await log_elicitation_event(
            interaction="workbench_watch_resource",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_watch_resource",
        mode="form",
        action="accept",
    )
    return confirmation, None


async def _confirm_coverage_target_create(
    ctx: WorkbenchElicitationContext,
) -> tuple[CreateCoverageTargetConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_coverage_target",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm creating this private Atlas workspace coverage target.",
        schema=CreateCoverageTargetConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_coverage_target",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("CreateCoverageTargetConfirmation", result.data)
    if not confirmation.confirm_create or not confirmation.source_linkage_ack:
        await log_elicitation_event(
            interaction="workbench_coverage_target",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_coverage_target",
        mode="form",
        action="accept",
    )
    return confirmation, None


async def _confirm_research_brief_create(
    ctx: WorkbenchElicitationContext,
) -> tuple[CreateResearchBriefConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_research_brief",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm creating this private Atlas workspace brief.",
        schema=CreateResearchBriefConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_research_brief",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("CreateResearchBriefConfirmation", result.data)
    if not confirmation.confirm_create or not confirmation.source_linkage_ack:
        await log_elicitation_event(
            interaction="workbench_research_brief",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_research_brief",
        mode="form",
        action="accept",
    )
    return confirmation, None


async def _confirm_research_brief_export(
    ctx: WorkbenchElicitationContext,
) -> tuple[ExportResearchBriefConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_brief_export",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm exporting this private Atlas workspace brief.",
        schema=ExportResearchBriefConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_brief_export",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("ExportResearchBriefConfirmation", result.data)
    if not confirmation.confirm_export or not confirmation.source_linkage_ack:
        await log_elicitation_event(
            interaction="workbench_brief_export",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_brief_export",
        mode="form",
        action="accept",
    )
    return confirmation, None


async def _confirm_coverage_report_export(
    ctx: WorkbenchElicitationContext,
) -> tuple[ExportCoverageReportConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_coverage_report_export",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm exporting this private Atlas workspace coverage report.",
        schema=ExportCoverageReportConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_coverage_report_export",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("ExportCoverageReportConfirmation", result.data)
    if not confirmation.confirm_export or not confirmation.source_linkage_ack:
        await log_elicitation_event(
            interaction="workbench_coverage_report_export",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_coverage_report_export",
        mode="form",
        action="accept",
    )
    return confirmation, None


async def _confirm_scout_artifact_sync(
    ctx: WorkbenchElicitationContext,
) -> tuple[SyncScoutArtifactsConfirmation | None, WorkbenchStopAction | None]:
    await log_elicitation_event(
        interaction="workbench_scout_artifact_sync",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Confirm syncing this reviewed Scout run to your Atlas workspace.",
        schema=SyncScoutArtifactsConfirmation,
    )
    if result.action != "accept":
        action = _stop_action(result.action)
        await log_elicitation_event(
            interaction="workbench_scout_artifact_sync",
            mode="form",
            action=action,
        )
        return None, action
    confirmation = cast("SyncScoutArtifactsConfirmation", result.data)
    if not confirmation.confirm_sync or not confirmation.source_linkage_ack:
        await log_elicitation_event(
            interaction="workbench_scout_artifact_sync",
            mode="form",
            action="decline",
        )
        return None, "decline"
    await log_elicitation_event(
        interaction="workbench_scout_artifact_sync",
        mode="form",
        action="accept",
    )
    return confirmation, None


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


async def _watch_request_from_context(
    ctx: WorkbenchElicitationContext | None,
    *,
    resource_type: WatchResourceType,
    resource_id: str,
    notification_preference: WatchNotificationPreference,
) -> tuple[WatchWorkspaceResourceRequest | None, dict[str, Any] | None]:
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_watch_resource",
            mode="form",
            action="unsupported",
        )
        return None, {
            "status": "unsupported",
            "message": "This MCP client cannot confirm workspace watches.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_watch_resource",
            mode="form",
            action="unavailable",
        )
        return None, {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return None, {
            "status": "unauthenticated",
            "message": "Atlas could not identify the MCP user.",
        }
    if org_id is None:
        return None, {
            "status": "unavailable",
            "message": "No workspace is active for this MCP request.",
        }

    confirmation, stop_action = await _confirm_workspace_watch(ctx)
    if confirmation is None:
        return None, {
            "status": stop_action,
            "message": "No workspace watch was created.",
        }
    return WatchWorkspaceResourceRequest(
        user_id=user_id,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
        notification_preference=notification_preference,
        confirmation=confirmation,
    ), None


async def _coverage_target_request_from_context(  # noqa: PLR0913
    ctx: WorkbenchElicitationContext | None,
    *,
    name: str,
    geography: str,
    issue_areas: list[str],
    actor_types: list[str],
    source_types: list[str],
    linked_discovery_run_ids: list[str],
    linked_entry_ids: list[str],
    gaps: list[dict[str, str]],
    next_actions: list[str],
) -> tuple[CreateCoverageTargetRequest | None, dict[str, Any] | None]:
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_coverage_target",
            mode="form",
            action="unsupported",
        )
        return None, {
            "status": "unsupported",
            "message": "This MCP client cannot confirm coverage-target writes.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_coverage_target",
            mode="form",
            action="unavailable",
        )
        return None, {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return None, {
            "status": "unauthenticated",
            "message": "Atlas could not identify the MCP user.",
        }
    if org_id is None:
        return None, {
            "status": "unavailable",
            "message": "No workspace is active for this MCP request.",
        }

    confirmation, stop_action = await _confirm_coverage_target_create(ctx)
    if confirmation is None:
        return None, {
            "status": stop_action,
            "message": "No coverage target was created.",
        }
    return CreateCoverageTargetRequest(
        user_id=user_id,
        org_id=org_id,
        name=name,
        geography=geography,
        issue_areas=issue_areas,
        actor_types=actor_types,
        source_types=source_types,
        linked_discovery_run_ids=linked_discovery_run_ids,
        linked_entry_ids=linked_entry_ids,
        gaps=gaps,
        next_actions=next_actions,
        confirmation=confirmation,
    ), None


async def _research_brief_request_from_context(  # noqa: PLR0913
    ctx: WorkbenchElicitationContext | None,
    *,
    title: str,
    scope: dict[str, Any],
    summary: str,
    linked_entry_ids: list[str],
    linked_source_ids: list[str],
    linked_discovery_run_ids: list[str],
    confidence_summary: dict[str, Any],
    gaps: list[dict[str, Any]],
) -> tuple[CreateResearchBriefRequest | None, dict[str, Any] | None]:
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_research_brief",
            mode="form",
            action="unsupported",
        )
        return None, {
            "status": "unsupported",
            "message": "This MCP client cannot confirm brief writes.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_research_brief",
            mode="form",
            action="unavailable",
        )
        return None, {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return None, {
            "status": "unauthenticated",
            "message": "Atlas could not identify the MCP user.",
        }
    if org_id is None:
        return None, {
            "status": "unavailable",
            "message": "No workspace is active for this MCP request.",
        }

    confirmation, stop_action = await _confirm_research_brief_create(ctx)
    if confirmation is None:
        return None, {"status": stop_action, "message": "No brief was created."}
    return CreateResearchBriefRequest(
        user_id=user_id,
        org_id=org_id,
        title=title,
        scope=scope,
        summary=summary,
        linked_entry_ids=linked_entry_ids,
        linked_source_ids=linked_source_ids,
        linked_discovery_run_ids=linked_discovery_run_ids,
        confidence_summary=confidence_summary,
        gaps=gaps,
        confirmation=confirmation,
    ), None


async def _coverage_report_export_request_from_context(
    ctx: WorkbenchElicitationContext | None,
) -> tuple[ExportCoverageReportRequest | None, dict[str, Any] | None]:
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_coverage_report_export",
            mode="form",
            action="unsupported",
        )
        return None, {
            "status": "unsupported",
            "message": "This MCP client cannot confirm coverage report exports.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_coverage_report_export",
            mode="form",
            action="unavailable",
        )
        return None, {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return None, {
            "status": "unauthenticated",
            "message": "Atlas could not identify the MCP user.",
        }
    if org_id is None:
        return None, {
            "status": "unavailable",
            "message": "No workspace is active for this MCP request.",
        }

    confirmation, stop_action = await _confirm_coverage_report_export(ctx)
    if confirmation is None:
        return None, {
            "status": stop_action,
            "message": "No coverage report was exported.",
        }
    return ExportCoverageReportRequest(
        user_id=user_id,
        org_id=org_id,
        confirmation=confirmation,
    ), None


async def _scout_artifacts_sync_request_from_context(
    ctx: WorkbenchElicitationContext | None,
    *,
    artifacts: DiscoveryRunArtifacts,
) -> tuple[SyncScoutArtifactsRequest | None, dict[str, Any] | None]:
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_scout_artifact_sync",
            mode="form",
            action="unsupported",
        )
        return None, {
            "status": "unsupported",
            "message": "This MCP client cannot confirm Scout artifact syncs.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_scout_artifact_sync",
            mode="form",
            action="unavailable",
        )
        return None, {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return None, {
            "status": "unauthenticated",
            "message": "Atlas could not identify the MCP user.",
        }
    if org_id is None:
        return None, {
            "status": "unavailable",
            "message": "No workspace is active for this MCP request.",
        }

    confirmation, stop_action = await _confirm_scout_artifact_sync(ctx)
    if confirmation is None:
        return None, {
            "status": stop_action,
            "message": "No Scout artifacts were synced.",
        }
    return SyncScoutArtifactsRequest(
        user_id=user_id,
        org_id=org_id,
        artifacts=artifacts,
        confirmation=confirmation,
    ), None


async def _research_brief_export_request_from_context(
    ctx: WorkbenchElicitationContext | None,
    *,
    brief_id: str,
) -> tuple[ExportResearchBriefRequest | None, dict[str, Any] | None]:
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_brief_export",
            mode="form",
            action="unsupported",
        )
        return None, {
            "status": "unsupported",
            "message": "This MCP client cannot confirm brief exports.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_brief_export",
            mode="form",
            action="unavailable",
        )
        return None, {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return None, {
            "status": "unauthenticated",
            "message": "Atlas could not identify the MCP user.",
        }
    if org_id is None:
        return None, {
            "status": "unavailable",
            "message": "No workspace is active for this MCP request.",
        }

    confirmation, stop_action = await _confirm_research_brief_export(ctx)
    if confirmation is None:
        return None, {"status": stop_action, "message": "No brief was exported."}
    return ExportResearchBriefRequest(
        user_id=user_id,
        org_id=org_id,
        brief_id=brief_id,
        confirmation=confirmation,
    ), None


async def save_entities_to_list(
    ctx: WorkbenchElicitationContext | None,
    *,
    list_id: str,
    entry_ids: list[str],
    note: str | None = None,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and save selected actors to an existing Atlas saved list."""
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="workbench_save_list",
            mode="form",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": "This MCP client cannot confirm saved-list writes.",
        }
    if ctx is None:
        await log_elicitation_event(
            interaction="workbench_save_list",
            mode="form",
            action="unavailable",
        )
        return {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return {"status": "unauthenticated", "message": "Atlas could not identify the MCP user."}

    confirmation, stop_action = await _confirm_saved_list_write(ctx)
    if confirmation is None:
        return {
            "status": stop_action,
            "message": "No actors were saved to the list.",
        }
    request = SaveEntitiesToListRequest(
        user_id=user_id,
        org_id=org_id,
        list_id=list_id,
        entry_ids=entry_ids,
        note=note,
        confirmation=confirmation,
    )

    if db is not None:
        return await _save_entities_to_list_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _save_entities_to_list_with_db(conn, request)
    finally:
        await conn.close()


async def export_research_brief(
    ctx: WorkbenchElicitationContext | None,
    *,
    brief_id: str,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and export a private workspace research brief."""
    request, error = await _research_brief_export_request_from_context(ctx, brief_id=brief_id)
    if error is not None:
        return error
    assert request is not None, "brief export request builder returns request or error"

    if db is not None:
        return await _export_research_brief_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _export_research_brief_with_db(conn, request)
    finally:
        await conn.close()


async def export_coverage_report(
    ctx: WorkbenchElicitationContext | None,
    *,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and export a private workspace coverage report."""
    request, error = await _coverage_report_export_request_from_context(ctx)
    if error is not None:
        return error
    assert request is not None, "coverage report request builder returns request or error"

    if db is not None:
        return await _export_coverage_report_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _export_coverage_report_with_db(conn, request)
    finally:
        await conn.close()


async def sync_scout_artifacts(
    ctx: WorkbenchElicitationContext | None,
    *,
    artifacts: DiscoveryRunArtifacts,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and sync reviewed Scout artifacts into the active workspace."""
    request, error = await _scout_artifacts_sync_request_from_context(ctx, artifacts=artifacts)
    if error is not None:
        return error
    assert request is not None, "Scout artifact sync request builder returns request or error"

    if db is not None:
        return await _sync_scout_artifacts_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _sync_scout_artifacts_with_db(conn, request)
    finally:
        await conn.close()


async def create_research_brief(  # noqa: PLR0913
    ctx: WorkbenchElicitationContext | None,
    *,
    title: str,
    scope: dict[str, Any],
    summary: str,
    linked_entry_ids: list[str] | None = None,
    linked_source_ids: list[str] | None = None,
    linked_discovery_run_ids: list[str] | None = None,
    confidence_summary: dict[str, Any] | None = None,
    gaps: list[dict[str, Any]] | None = None,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and create a private workspace research brief."""
    request, error = await _research_brief_request_from_context(
        ctx,
        title=title,
        scope=scope,
        summary=summary,
        linked_entry_ids=list(linked_entry_ids or []),
        linked_source_ids=list(linked_source_ids or []),
        linked_discovery_run_ids=list(linked_discovery_run_ids or []),
        confidence_summary=dict(confidence_summary or {}),
        gaps=list(gaps or []),
    )
    if error is not None:
        return error
    assert request is not None, "brief request builder returns request or error"

    if db is not None:
        return await _create_research_brief_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _create_research_brief_with_db(conn, request)
    finally:
        await conn.close()


async def create_coverage_target(  # noqa: PLR0913
    ctx: WorkbenchElicitationContext | None,
    *,
    name: str,
    geography: str,
    issue_areas: list[str],
    actor_types: list[str],
    source_types: list[str],
    linked_discovery_run_ids: list[str] | None = None,
    linked_entry_ids: list[str] | None = None,
    gaps: list[dict[str, str]] | None = None,
    next_actions: list[str] | None = None,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and create a private workspace coverage target."""
    request, error = await _coverage_target_request_from_context(
        ctx,
        name=name,
        geography=geography,
        issue_areas=issue_areas,
        actor_types=actor_types,
        source_types=source_types,
        linked_discovery_run_ids=list(linked_discovery_run_ids or []),
        linked_entry_ids=list(linked_entry_ids or []),
        gaps=list(gaps or []),
        next_actions=list(next_actions or []),
    )
    if error is not None:
        return error
    assert request is not None, "coverage target request builder returns request or error"

    if db is not None:
        return await _create_coverage_target_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _create_coverage_target_with_db(conn, request)
    finally:
        await conn.close()


async def watch_workspace_resource(
    ctx: WorkbenchElicitationContext | None,
    *,
    resource_type: WatchResourceType,
    resource_id: str,
    notification_preference: WatchNotificationPreference = "digest",
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and watch an Atlas workspace resource."""
    request, error = await _watch_request_from_context(
        ctx,
        resource_type=resource_type,
        resource_id=resource_id,
        notification_preference=notification_preference,
    )
    if error is not None:
        return error
    assert request is not None, "watch request builder returns request or error"

    if db is not None:
        return await _watch_workspace_resource_with_db(db, request)

    settings = get_settings()
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        return await _watch_workspace_resource_with_db(conn, request)
    finally:
        await conn.close()
