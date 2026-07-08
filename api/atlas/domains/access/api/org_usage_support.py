"""Support helpers for org usage summary endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import require_org_actor, require_org_role
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    import aiosqlite

    from atlas.domains.access import AuthenticatedActor
    from atlas.domains.access.models.usage_events import (
        OrgIntegrationResourceUsage,
        OrgIntegrationSurfaceCounts,
        OrgUsageEventModel,
    )
EvidenceOpenSurface = Literal["brief", "coverage_target", "watch_digest", "saved_list", "profile"]

IntegrationSurface = Literal["api", "mcp"]


class OrgEvidenceOpenRequest(BaseModel):
    """Source receipt open event from a workspace evidence surface."""

    source_id: str = Field(..., min_length=1)
    surface: EvidenceOpenSurface


class OrgUsageEventResponse(BaseModel):
    """Recorded workspace usage event."""

    id: str
    org_id: str
    actor_id: str | None
    event_type: str
    resource_type: str | None
    resource_id: str | None
    created_at: str


class OrgUsageRenewalSignals(BaseModel):
    """Renewal-proof usage totals grouped into customer-success language."""

    briefs_used: int
    team_workflow_actions: int
    coverage_gaps_closed: int
    integrations_used: int
    public_records_improved: int


class OrgUsageSummaryResponse(BaseModel):
    """Customer-success summary for one workspace."""

    org_id: str
    total_events: int
    event_counts: dict[str, int]
    renewal_signals: OrgUsageRenewalSignals


class OrgUsageAuditLogDataBoundary(BaseModel):
    """Boundary statement for customer-safe workspace usage audit logs."""

    metadata_included: bool
    session_replay_included: bool
    statement: str


class OrgUsageAuditLogResponse(BaseModel):
    """Customer-safe usage audit log for one workspace."""

    org_id: str
    items: list[OrgUsageEventResponse]
    total: int
    limit: int
    offset: int
    data_boundary: OrgUsageAuditLogDataBoundary


class OrgIntegrationResourceCount(BaseModel):
    """Aggregated integration activity for one route or tool surface."""

    resource_id: str
    surface: IntegrationSurface
    total_calls: int
    last_seen_at: str


class OrgIntegrationMonitoringDataBoundary(BaseModel):
    """Boundary statement for workspace integration activity."""

    request_metadata_included: bool = Field(
        description="Whether request metadata is included in the workspace integration view."
    )
    session_replay_included: bool = Field(
        description="Whether behavioral session replay is included in the workspace integration view."
    )
    statement: str = Field(
        description="Plain-language boundary for the workspace integration activity summary."
    )


class OrgIntegrationMonitoringResponse(BaseModel):
    """Customer-safe workspace integration activity summary for one workspace."""

    org_id: str = Field(description="Workspace id for the integration activity summary.")
    total_calls: int = Field(description="Total API and MCP calls counted for this workspace.")
    api_calls: int = Field(description="REST API calls counted for this workspace.")
    mcp_calls: int = Field(description="MCP calls counted for this workspace.")
    last_seen_at: str | None = Field(description="Most recent integration activity timestamp.")
    top_resources: list[OrgIntegrationResourceCount] = Field(
        description="Most-used API paths and MCP resources for this workspace."
    )
    data_boundary: OrgIntegrationMonitoringDataBoundary


class OrgRenewalPacketMetric(BaseModel):
    """One customer-success metric in a renewal packet."""

    label: str
    value: int
    detail: str


class OrgRenewalPacketDataBoundary(BaseModel):
    """Boundary statement for renewal packets."""

    private_workspace_notes_included: bool
    session_replay_included: bool
    statement: str


class OrgRenewalPacketResponse(BaseModel):
    """Exportable customer-success renewal packet for one workspace."""

    format: Literal["json"]
    generated_at: str
    org_id: str
    summary: OrgUsageSummaryResponse
    metrics: list[OrgRenewalPacketMetric]
    highlights: list[str]
    data_boundary: OrgRenewalPacketDataBoundary


@dataclass(slots=True)
class UsageSummaryContext:
    """Shared request dependencies for usage summary routes."""

    response: Response
    actor: AuthenticatedActor
    db: aiosqlite.Connection


@dataclass(slots=True)
class UsageEventContext:
    """Shared request dependencies for usage event recording routes."""

    response: Response
    actor: AuthenticatedActor
    db: aiosqlite.Connection


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


async def get_usage_summary_context(
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> UsageSummaryContext:
    """Return shared usage route dependencies after admin auth checks."""
    return UsageSummaryContext(response=response, actor=actor, db=db)


async def get_usage_event_context(
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> UsageEventContext:
    """Return shared usage-event route dependencies after workspace auth checks."""
    return UsageEventContext(response=response, actor=actor, db=db)


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


def _usage_event_response(event: OrgUsageEventModel) -> OrgUsageEventResponse:
    """Build a public response for a recorded usage event."""
    return OrgUsageEventResponse(
        id=event.id,
        org_id=event.org_id,
        actor_id=event.actor_id,
        event_type=event.event_type,
        resource_type=event.resource_type,
        resource_id=event.resource_id,
        created_at=event.created_at,
    )


def _count(event_counts: dict[str, int], event_type: str) -> int:
    """Return the count for one event type, defaulting to zero."""
    return event_counts.get(event_type, 0)


def _renewal_signals(event_counts: dict[str, int]) -> OrgUsageRenewalSignals:
    """Translate raw product-event counts into renewal summary signals."""
    return OrgUsageRenewalSignals(
        briefs_used=_count(event_counts, "brief_opened") + _count(event_counts, "brief_exported"),
        team_workflow_actions=(
            _count(event_counts, "list_item_saved")
            + _count(event_counts, "watch_created")
            + _count(event_counts, "digest_viewed")
        ),
        coverage_gaps_closed=_count(event_counts, "coverage_gap_closed"),
        integrations_used=_count(event_counts, "api_call"),
        public_records_improved=_count(event_counts, "public_record_improved"),
    )


def _usage_summary_response(
    *, org_id: str, event_counts: dict[str, int]
) -> OrgUsageSummaryResponse:
    """Build the shared usage summary response."""
    return OrgUsageSummaryResponse(
        org_id=org_id,
        total_events=sum(event_counts.values()),
        event_counts=event_counts,
        renewal_signals=_renewal_signals(event_counts),
    )


def _renewal_packet_metrics(signals: OrgUsageRenewalSignals) -> list[OrgRenewalPacketMetric]:
    """Return renewal metrics in customer-success display order."""
    return [
        OrgRenewalPacketMetric(
            label="Briefs used",
            value=signals.briefs_used,
            detail="Brief opens and exports.",
        ),
        OrgRenewalPacketMetric(
            label="Team workflow actions",
            value=signals.team_workflow_actions,
            detail="List saves, watch creation, and digest views.",
        ),
        OrgRenewalPacketMetric(
            label="Coverage gaps closed",
            value=signals.coverage_gaps_closed,
            detail="Coverage targets that moved to covered.",
        ),
        OrgRenewalPacketMetric(
            label="Integrations used",
            value=signals.integrations_used,
            detail="API activity counted for renewal reporting.",
        ),
        OrgRenewalPacketMetric(
            label="Public records improved",
            value=signals.public_records_improved,
            detail="First-time source-backed public directory publishes.",
        ),
    ]


def _renewal_packet_boundary() -> OrgRenewalPacketDataBoundary:
    """Return the renewal packet boundary statement."""
    return OrgRenewalPacketDataBoundary(
        private_workspace_notes_included=False,
        session_replay_included=False,
        statement=(
            "The renewal packet summarizes product outcomes without private notes "
            "or behavioral session replay."
        ),
    )


def _usage_audit_log_boundary() -> OrgUsageAuditLogDataBoundary:
    """Return the audit-log boundary statement."""
    return OrgUsageAuditLogDataBoundary(
        metadata_included=False,
        session_replay_included=False,
        statement=(
            "The audit log shows timestamped workspace usage events without private metadata "
            "or behavioral session replay."
        ),
    )


def _integration_monitoring_boundary() -> OrgIntegrationMonitoringDataBoundary:
    """Return the integration monitoring boundary statement."""
    return OrgIntegrationMonitoringDataBoundary(
        request_metadata_included=False,
        session_replay_included=False,
        statement=(
            "Workspace integration activity records counts, surfaces, paths, and last-seen "
            "times without request metadata or behavioral session replay."
        ),
    )


def _integration_monitoring_response(
    *,
    org_id: str,
    surface_counts: OrgIntegrationSurfaceCounts,
    top_resources: list[OrgIntegrationResourceUsage],
) -> OrgIntegrationMonitoringResponse:
    """Build the public workspace integration summary."""
    return OrgIntegrationMonitoringResponse(
        org_id=org_id,
        total_calls=surface_counts.total_calls,
        api_calls=surface_counts.api_calls,
        mcp_calls=surface_counts.mcp_calls,
        last_seen_at=surface_counts.last_seen_at,
        top_resources=[
            OrgIntegrationResourceCount(
                resource_id=resource.resource_id,
                surface=resource.surface,
                total_calls=resource.total_calls,
                last_seen_at=resource.last_seen_at,
            )
            for resource in top_resources
        ],
        data_boundary=_integration_monitoring_boundary(),
    )


def _renewal_packet_response(
    *, org_id: str, event_counts: dict[str, int]
) -> OrgRenewalPacketResponse:
    """Build the exportable renewal packet payload."""
    summary = _usage_summary_response(org_id=org_id, event_counts=event_counts)
    metrics = _renewal_packet_metrics(summary.renewal_signals)
    return OrgRenewalPacketResponse(
        format="json",
        generated_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        org_id=org_id,
        summary=summary,
        metrics=metrics,
        highlights=[f"{metric.label}: {metric.value}" for metric in metrics if metric.value > 0]
        or ["No renewal events yet."],
        data_boundary=_renewal_packet_boundary(),
    )


def _renewal_packet_markdown(packet: OrgRenewalPacketResponse) -> str:
    """Render a renewal packet as a compact customer-success markdown brief."""
    lines = [
        "# Atlas renewal packet",
        "",
        f"Workspace: {packet.org_id}",
        "",
        f"Generated: {packet.generated_at}",
        "",
        "## Summary",
        f"- Total events: {packet.summary.total_events}",
        f"- Briefs used: {packet.summary.renewal_signals.briefs_used}",
        f"- Team workflow actions: {packet.summary.renewal_signals.team_workflow_actions}",
        f"- Coverage gaps closed: {packet.summary.renewal_signals.coverage_gaps_closed}",
        f"- Integrations used: {packet.summary.renewal_signals.integrations_used}",
        f"- Public records improved: {packet.summary.renewal_signals.public_records_improved}",
        "",
        "## Metrics",
    ]
    lines.extend(f"- {metric.label}: {metric.value} ({metric.detail})" for metric in packet.metrics)
    lines.extend(
        [
            "",
            "## Highlights",
        ]
    )
    lines.extend(f"- {highlight}" for highlight in packet.highlights)
    lines.extend(
        [
            "",
            "## Data boundary",
            f"- Private workspace notes included: {packet.data_boundary.private_workspace_notes_included}",
            f"- Session replay included: {packet.data_boundary.session_replay_included}",
            f"- Statement: {packet.data_boundary.statement}",
        ]
    )
    return "\n".join(lines)
