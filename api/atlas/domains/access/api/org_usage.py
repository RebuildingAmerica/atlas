"""Org-scoped workspace usage summary endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.models import SourceCRUD
from atlas.platform.database import db as db_util
from atlas.platform.http.cache import apply_no_store_headers

from .org_usage_support import (
    OrgEvidenceOpenRequest,
    OrgIntegrationMonitoringResponse,
    OrgRenewalPacketResponse,
    OrgUsageAuditLogResponse,
    OrgUsageEventResponse,
    OrgUsageSummaryResponse,
    UsageEventContext,
    UsageSummaryContext,
    _integration_monitoring_response,
    _renewal_packet_markdown,
    _renewal_packet_response,
    _usage_audit_log_boundary,
    _usage_event_response,
    _usage_summary_response,
    _verify_org_access,
    get_usage_event_context,
    get_usage_summary_context,
)

router = APIRouter()

__all__ = ["router"]


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
