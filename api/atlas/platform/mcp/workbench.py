"""MCP Workbench write handoffs."""

from __future__ import annotations

from atlas.platform.config import get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.mcp.elicitation import declares_form_elicitation, log_elicitation_event

from .workbench_models import (
    CreateCoverageTargetConfirmation,
    CreateResearchBriefConfirmation,
    ExportCoverageReportConfirmation,
    ExportResearchBriefConfirmation,
    SaveEntitiesToListConfirmation,
    SyncScoutArtifactsConfirmation,
    WatchWorkspaceResourceConfirmation,
    _actor_claims_from_context,
    _request_meta_from_context,
)
from .workbench_public import (
    create_coverage_target,
    create_research_brief,
    export_coverage_report,
    export_research_brief,
    save_entities_to_list,
    sync_scout_artifacts,
    watch_workspace_resource,
)
from .workbench_storage_reads import (
    _create_research_brief_with_db,
    _watch_workspace_resource_with_db,
)
from .workbench_storage_writes import (
    _create_coverage_target_with_db,
    _export_coverage_report_with_db,
    _export_research_brief_with_db,
    _save_entities_to_list_with_db,
    _sync_scout_artifacts_with_db,
)

__all__ = [
    "CreateCoverageTargetConfirmation",
    "CreateResearchBriefConfirmation",
    "ExportCoverageReportConfirmation",
    "ExportResearchBriefConfirmation",
    "SaveEntitiesToListConfirmation",
    "SyncScoutArtifactsConfirmation",
    "WatchWorkspaceResourceConfirmation",
    "_actor_claims_from_context",
    "_create_coverage_target_with_db",
    "_create_research_brief_with_db",
    "_export_coverage_report_with_db",
    "_export_research_brief_with_db",
    "_request_meta_from_context",
    "_save_entities_to_list_with_db",
    "_sync_scout_artifacts_with_db",
    "_watch_workspace_resource_with_db",
    "create_coverage_target",
    "create_research_brief",
    "declares_form_elicitation",
    "export_coverage_report",
    "export_research_brief",
    "get_db_connection",
    "get_settings",
    "log_elicitation_event",
    "save_entities_to_list",
    "sync_scout_artifacts",
    "watch_workspace_resource",
]
