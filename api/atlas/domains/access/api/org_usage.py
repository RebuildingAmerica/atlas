"""Org-scoped workspace usage summary endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import require_org_actor, require_org_role
from atlas.domains.access.models.usage_events import (
    OrgIntegrationResourceUsage,
    OrgIntegrationSurfaceCounts,
    OrgUsageEventCRUD,
    OrgUsageEventModel,
    OrgUsageEventRecord,
)
from atlas.models import SourceCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import db as db_util
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]

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
            label="Workflow actions",
            value=signals.team_workflow_actions,
            detail="List saves, watch creation, and digest views.",
        ),
        OrgRenewalPacketMetric(
            label="Coverage gaps closed",
            value=signals.coverage_gaps_closed,
            detail="Coverage targets that moved to covered.",
        ),
        OrgRenewalPacketMetric(
            label="Public records improved",
            value=signals.public_records_improved,
            detail="First-time source-backed public directory publishes.",
        ),
        OrgRenewalPacketMetric(
            label="Integrations used",
            value=signals.integrations_used,
            detail="API activity counted for renewal reporting.",
        ),
    ]


def _renewal_packet_boundary() -> OrgRenewalPacketDataBoundary:
    """Return the privacy boundary for renewal packets."""
    return OrgRenewalPacketDataBoundary(
        private_workspace_notes_included=False,
        session_replay_included=False,
        statement=(
            "The renewal packet summarizes product outcomes without private notes "
            "or behavioral session replay."
        ),
    )


def _usage_audit_log_boundary() -> OrgUsageAuditLogDataBoundary:
    """Return the privacy boundary for customer-safe audit logs."""
    return OrgUsageAuditLogDataBoundary(
        metadata_included=False,
        session_replay_included=False,
        statement=(
            "The audit log shows timestamped workspace usage events without private "
            "metadata or behavioral session replay."
        ),
    )


def _integration_monitoring_boundary() -> OrgIntegrationMonitoringDataBoundary:
    """Return the privacy boundary for workspace integration activity."""
    return OrgIntegrationMonitoringDataBoundary(
        request_metadata_included=False,
        session_replay_included=False,
        statement=(
            "Workspace integration activity records counts, surfaces, paths, and "
            "last-seen times without request metadata or behavioral session replay."
        ),
    )


def _integration_monitoring_response(
    *,
    org_id: str,
    surface_counts: OrgIntegrationSurfaceCounts,
    top_resources: list[OrgIntegrationResourceUsage],
) -> OrgIntegrationMonitoringResponse:
    """Build the customer-safe workspace integration activity summary."""
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
    """Build a portable customer-success renewal packet."""
    summary = _usage_summary_response(org_id=org_id, event_counts=event_counts)
    metrics = _renewal_packet_metrics(summary.renewal_signals)
    highlights = [f"{metric.label}: {metric.value}" for metric in metrics if metric.value > 0]
    if not highlights:
        highlights = ["No renewal events yet."]

    return OrgRenewalPacketResponse(
        format="json",
        generated_at=datetime.now(UTC).isoformat(),
        org_id=org_id,
        summary=summary,
        metrics=metrics,
        highlights=highlights,
        data_boundary=_renewal_packet_boundary(),
    )


def _renewal_packet_markdown(packet: OrgRenewalPacketResponse) -> str:
    """Serialize a renewal packet as Markdown for customer-success handoff."""
    metric_lines = "\n".join(
        f"- {metric.label}: {metric.value} ({metric.detail})" for metric in packet.metrics
    )
    highlight_lines = "\n".join(f"- {highlight}" for highlight in packet.highlights)
    event_lines = "\n".join(
        f"- {event_type}: {count}"
        for event_type, count in sorted(packet.summary.event_counts.items())
    )
    if not event_lines:
        event_lines = "- No renewal events yet."

    return "\n".join(
        [
            "# Atlas renewal packet",
            "",
            f"Workspace: {packet.org_id}",
            f"Generated: {packet.generated_at}",
            "",
            "## Highlights",
            highlight_lines,
            "",
            "## Renewal metrics",
            metric_lines,
            "",
            "## Event counts",
            event_lines,
            "",
            "## Data boundary",
            f"- Private workspace notes included: {packet.data_boundary.private_workspace_notes_included}",
            f"- Session replay included: {packet.data_boundary.session_replay_included}",
            f"- {packet.data_boundary.statement}",
            "",
        ]
    )


@router.get(
    "",
    response_model=OrgUsageSummaryResponse,
    summary="Get workspace usage summary",
    operation_id="getOrgUsageSummary",
    tags=["org-usage"],
)
async def get_org_usage_summary(
    org_id: str,
    context: UsageSummaryContext = Depends(get_usage_summary_context),
) -> OrgUsageSummaryResponse:
    """Return non-invasive renewal usage counts for one workspace."""
    _verify_org_access(context.actor, org_id)
    event_counts = await OrgUsageEventCRUD.count_by_type(context.db, org_id=org_id)
    apply_no_store_headers(context.response)
    return _usage_summary_response(org_id=org_id, event_counts=event_counts)


@router.get(
    "/audit-log",
    response_model=OrgUsageAuditLogResponse,
    summary="Get workspace usage audit log",
    operation_id="getOrgUsageAuditLog",
    tags=["org-usage"],
)
async def get_org_usage_audit_log(
    org_id: str,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    context: UsageSummaryContext = Depends(get_usage_summary_context),
) -> OrgUsageAuditLogResponse:
    """Return a customer-safe usage audit log for one workspace."""
    _verify_org_access(context.actor, org_id)
    events = await OrgUsageEventCRUD.list_by_org(
        context.db,
        org_id=org_id,
        limit=limit,
        offset=offset,
    )
    total = await OrgUsageEventCRUD.count_by_org(context.db, org_id=org_id)
    apply_no_store_headers(context.response)
    return OrgUsageAuditLogResponse(
        org_id=org_id,
        items=[_usage_event_response(event) for event in events],
        total=total,
        limit=limit,
        offset=offset,
        data_boundary=_usage_audit_log_boundary(),
    )


@router.get(
    "/integrations",
    response_model=OrgIntegrationMonitoringResponse,
    summary="Get workspace integration activity",
    operation_id="getOrgIntegrationMonitoring",
    tags=["org-usage"],
)
async def get_org_integration_monitoring(
    org_id: str,
    context: UsageSummaryContext = Depends(get_usage_summary_context),
) -> OrgIntegrationMonitoringResponse:
    """Return customer-safe workspace integration activity for one workspace."""
    _verify_org_access(context.actor, org_id)
    surface_counts = await OrgUsageEventCRUD.count_integration_calls_by_surface(
        context.db, org_id=org_id
    )
    top_resources = await OrgUsageEventCRUD.list_top_integration_resources(
        context.db, org_id=org_id
    )
    apply_no_store_headers(context.response)
    return _integration_monitoring_response(
        org_id=org_id,
        surface_counts=surface_counts,
        top_resources=top_resources,
    )


@router.post(
    "/evidence-opens",
    response_model=OrgUsageEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record source evidence opened",
    operation_id="recordOrgEvidenceOpen",
    tags=["org-usage"],
)
async def record_org_evidence_open(
    org_id: str,
    payload: OrgEvidenceOpenRequest,
    context: UsageEventContext = Depends(get_usage_event_context),
) -> OrgUsageEventResponse:
    """Record a deliberate workspace source-receipt open for renewal proof."""
    _verify_org_access(context.actor, org_id)
    if await SourceCRUD.get_by_id(context.db, payload.source_id) is None:
        raise HTTPException(status_code=404, detail="Source not found")

    event = await OrgUsageEventCRUD.record(
        context.db,
        OrgUsageEventRecord(
            org_id=org_id,
            actor_id=context.actor.user_id,
            event_type="evidence_opened",
            resource_type="source",
            resource_id=payload.source_id,
            metadata_json=db_util.encode_json({"surface": payload.surface}),
        ),
    )
    apply_no_store_headers(context.response)
    return _usage_event_response(event)


@router.get(
    "/renewal-packet",
    response_model=OrgRenewalPacketResponse,
    summary="Export workspace renewal packet",
    operation_id="exportOrgUsageRenewalPacket",
    tags=["org-usage"],
)
async def export_org_usage_renewal_packet(
    org_id: str,
    export_format: Literal["json", "markdown"] = Query("json", alias="format"),
    context: UsageSummaryContext = Depends(get_usage_summary_context),
) -> OrgRenewalPacketResponse | Response:
    """Export customer-success renewal proof for one workspace."""
    _verify_org_access(context.actor, org_id)
    event_counts = await OrgUsageEventCRUD.count_by_type(context.db, org_id=org_id)
    packet = _renewal_packet_response(org_id=org_id, event_counts=event_counts)

    if export_format == "markdown":
        markdown_response = Response(
            content=_renewal_packet_markdown(packet),
            media_type="text/markdown; charset=utf-8",
        )
        markdown_response.headers["content-disposition"] = (
            f'attachment; filename="atlas-renewal-{org_id}.md"'
        )
        apply_no_store_headers(markdown_response)
        return markdown_response

    apply_no_store_headers(context.response)
    return packet
