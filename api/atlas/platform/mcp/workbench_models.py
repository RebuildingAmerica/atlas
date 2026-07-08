"""Workbench models and context helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from pydantic import BaseModel, ConfigDict, Field

from atlas.domains.access.models.watches import (
    WatchNotificationPreference,
    WatchResourceType,
)
from atlas.domains.discovery.coverage_targets import CoverageReviewState  # noqa: TC001
from atlas.platform.mcp.auth_middleware import _string_claim

if TYPE_CHECKING:
    from atlas_shared import DiscoveryRunArtifacts

WorkbenchStopAction = Literal["decline", "cancel"]


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


__all__ = [
    "CreateCoverageTargetConfirmation",
    "CreateCoverageTargetRequest",
    "CreateResearchBriefConfirmation",
    "CreateResearchBriefRequest",
    "ExportCoverageReportConfirmation",
    "ExportCoverageReportRequest",
    "ExportResearchBriefConfirmation",
    "ExportResearchBriefRequest",
    "SaveEntitiesToListConfirmation",
    "SaveEntitiesToListRequest",
    "SyncScoutArtifactsConfirmation",
    "SyncScoutArtifactsRequest",
    "WatchNotificationPreference",
    "WatchResourceType",
    "WatchWorkspaceResourceConfirmation",
    "WatchWorkspaceResourceRequest",
    "WorkbenchElicitationContext",
    "WorkbenchStopAction",
    "_actor_claims_from_context",
    "_request_meta_from_context",
    "_stop_action",
]
