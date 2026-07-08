"""Workbench request builders."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.platform.mcp.elicitation import declares_form_elicitation, log_elicitation_event

from .workbench_confirmation import (
    _confirm_coverage_report_export,
    _confirm_coverage_target_create,
    _confirm_research_brief_create,
    _confirm_research_brief_export,
    _confirm_scout_artifact_sync,
    _confirm_workspace_watch,
)
from .workbench_models import (
    CreateCoverageTargetRequest,
    CreateResearchBriefRequest,
    ExportCoverageReportRequest,
    ExportResearchBriefRequest,
    SyncScoutArtifactsRequest,
    WatchNotificationPreference,
    WatchResourceType,
    WatchWorkspaceResourceRequest,
    WorkbenchElicitationContext,
    _actor_claims_from_context,
    _request_meta_from_context,
)

if TYPE_CHECKING:
    from atlas_shared import DiscoveryRunArtifacts


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
