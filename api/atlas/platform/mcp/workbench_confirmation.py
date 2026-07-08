"""Workbench confirmation helpers."""

from __future__ import annotations

from typing import cast

from atlas.platform.mcp.elicitation import log_elicitation_event

from .workbench_models import (
    CreateCoverageTargetConfirmation,
    CreateResearchBriefConfirmation,
    ExportCoverageReportConfirmation,
    ExportResearchBriefConfirmation,
    SaveEntitiesToListConfirmation,
    SyncScoutArtifactsConfirmation,
    WatchWorkspaceResourceConfirmation,
    WorkbenchElicitationContext,
    WorkbenchStopAction,
    _stop_action,
)


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
