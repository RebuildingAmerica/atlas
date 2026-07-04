"""Org-scoped private Atlas Brief endpoints."""

from __future__ import annotations

import csv
import io
import re
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD, OrgBriefModel
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]

CSV_COLUMNS = [
    "row_type",
    "record_id",
    "title",
    "name",
    "record_type",
    "detail",
    "url",
    "publication",
    "published_date",
    "location",
    "state",
    "issue_areas",
    "research_goal",
    "status",
    "confidence_state",
    "review_status",
    "source_count",
    "entry_count",
    "discovery_run_count",
    "updated_at",
]


class OrgBriefScope(BaseModel):
    """Research scope represented by an Atlas Brief."""

    geography: str = Field(..., min_length=1)
    issue_areas: list[str] = Field(..., min_length=1)
    actor_types: list[str] = Field(..., min_length=1)
    source_types: list[str] = Field(..., min_length=1)


class OrgBriefConfidenceSummary(BaseModel):
    """Trust summary for a private Atlas Brief."""

    state: Literal["corroborated", "partial", "unverified"]
    source_count: int = Field(..., ge=0)
    review_status: str = Field(..., min_length=1)


class OrgBriefGap(BaseModel):
    """Known gap or unknown represented in an Atlas Brief."""

    label: str = Field(..., min_length=1)
    detail: str = Field(..., min_length=1)


class OrgBriefCreateRequest(BaseModel):
    """Request to create a private Atlas Brief artifact."""

    title: str = Field(..., min_length=1)
    scope: OrgBriefScope
    summary: str = Field(..., min_length=1)
    linked_entry_ids: list[str]
    linked_source_ids: list[str]
    linked_discovery_run_ids: list[str]
    confidence_summary: OrgBriefConfidenceSummary
    gaps: list[OrgBriefGap]


class OrgBriefUpdateRequest(BaseModel):
    """Request to update editable private Atlas Brief memo fields."""

    title: str | None = Field(None, min_length=1)
    summary: str | None = Field(None, min_length=1)
    confidence_summary: OrgBriefConfidenceSummary | None = None
    gaps: list[OrgBriefGap] | None = None


class OrgBriefResponse(BaseModel):
    """Private Atlas Brief artifact response."""

    id: str
    org_id: str
    title: str
    scope: OrgBriefScope
    summary: str
    linked_entry_ids: list[str]
    linked_source_ids: list[str]
    linked_discovery_run_ids: list[str]
    confidence_summary: OrgBriefConfidenceSummary
    gaps: list[OrgBriefGap]
    created_by: str
    created_at: str
    updated_at: str


class OrgBriefCollectionResponse(BaseModel):
    """Collection response for private Atlas Brief artifacts."""

    items: list[OrgBriefResponse]
    total: int


class OrgBriefExportEntry(BaseModel):
    """Linked actor context included in a brief export."""

    id: str
    name: str
    type: str
    city: str | None
    state: str | None


class OrgBriefExportSource(BaseModel):
    """Source receipt included in a brief export."""

    id: str
    url: str
    title: str | None
    publication: str | None
    published_date: str | None
    type: str
    ingested_at: str


class OrgBriefExportDiscoveryRun(BaseModel):
    """Discovery run context included in a brief export."""

    id: str
    location_query: str
    state: str
    issue_areas: list[str]
    research_goal: str
    status: str


class OrgBriefExportProvenance(BaseModel):
    """Summary of provenance carried by a brief export."""

    source_count: int
    entry_count: int
    discovery_run_count: int
    confidence_state: Literal["corroborated", "partial", "unverified"]
    review_status: str


class OrgBriefExportResponse(BaseModel):
    """JSON export for a private Atlas Brief with provenance."""

    format: Literal["json"] = "json"
    brief: OrgBriefResponse
    entries: list[OrgBriefExportEntry]
    sources: list[OrgBriefExportSource]
    discovery_runs: list[OrgBriefExportDiscoveryRun]
    provenance: OrgBriefExportProvenance


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Get a request-scoped database connection.

    Parameters
    ----------
    settings
        Runtime settings.

    Yields
    ------
    aiosqlite.Connection
        Database connection.
    """
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id.

    Parameters
    ----------
    actor
        Authenticated actor.
    org_id
        Workspace ID from the route path.
    """
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


def _brief_response(brief: OrgBriefModel) -> OrgBriefResponse:
    """Project a brief model into the API response shape.

    Parameters
    ----------
    brief
        Stored brief model.

    Returns
    -------
    OrgBriefResponse
        Response model.
    """
    return OrgBriefResponse(
        id=brief.id,
        org_id=brief.org_id,
        title=brief.title,
        scope=OrgBriefScope.model_validate(brief.scope),
        summary=brief.summary,
        linked_entry_ids=brief.linked_entry_ids,
        linked_source_ids=brief.linked_source_ids,
        linked_discovery_run_ids=brief.linked_discovery_run_ids,
        confidence_summary=OrgBriefConfidenceSummary.model_validate(brief.confidence_summary),
        gaps=[OrgBriefGap.model_validate(gap) for gap in brief.gaps],
        created_by=brief.created_by,
        created_at=brief.created_at,
        updated_at=brief.updated_at,
    )


async def _brief_export_response(
    conn: aiosqlite.Connection,
    brief: OrgBriefModel,
) -> OrgBriefExportResponse:
    """Build the portable JSON export for a private Atlas Brief.

    Parameters
    ----------
    conn
        Database connection.
    brief
        Stored brief model.

    Returns
    -------
    OrgBriefExportResponse
        Export payload with source receipts and linked context.
    """
    entries: list[OrgBriefExportEntry] = []
    for entry_id in brief.linked_entry_ids:
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        if entry is not None:
            entries.append(
                OrgBriefExportEntry(
                    id=entry.id,
                    name=entry.name,
                    type=entry.type,
                    city=entry.city,
                    state=entry.state,
                )
            )

    sources: list[OrgBriefExportSource] = []
    for source_id in brief.linked_source_ids:
        source = await SourceCRUD.get_by_id(conn, source_id)
        if source is not None:
            sources.append(
                OrgBriefExportSource(
                    id=source.id,
                    url=source.url,
                    title=source.title,
                    publication=source.publication,
                    published_date=(
                        source.published_date.isoformat() if source.published_date else None
                    ),
                    type=source.type,
                    ingested_at=source.ingested_at,
                )
            )

    discovery_runs: list[OrgBriefExportDiscoveryRun] = []
    for run_id in brief.linked_discovery_run_ids:
        run = await DiscoveryRunCRUD.get_by_id(conn, run_id)
        if run is not None:
            discovery_runs.append(
                OrgBriefExportDiscoveryRun(
                    id=run.id,
                    location_query=run.location_query,
                    state=run.state,
                    issue_areas=run.issue_areas,
                    research_goal=run.research_goal,
                    status=run.status,
                )
            )

    confidence_summary = OrgBriefConfidenceSummary.model_validate(brief.confidence_summary)
    return OrgBriefExportResponse(
        brief=_brief_response(brief),
        entries=entries,
        sources=sources,
        discovery_runs=discovery_runs,
        provenance=OrgBriefExportProvenance(
            source_count=len(sources),
            entry_count=len(entries),
            discovery_run_count=len(discovery_runs),
            confidence_state=confidence_summary.state,
            review_status=confidence_summary.review_status,
        ),
    )


def _csv_filename_segment(value: str) -> str:
    """Normalize a brief title into a stable CSV filename segment.

    Parameters
    ----------
    value
        Brief title.

    Returns
    -------
    str
        Lowercase filename segment.
    """
    segment = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return segment or "atlas-brief"


def _brief_csv_filename(brief: OrgBriefResponse) -> str:
    """Build the download filename for a CSV brief export.

    Parameters
    ----------
    brief
        Exported brief response.

    Returns
    -------
    str
        Download filename.
    """
    return f"{_csv_filename_segment(brief.title)}-{brief.id}.csv"


def _brief_export_csv(export: OrgBriefExportResponse) -> str:
    """Serialize a private Atlas Brief export as meeting-ready CSV.

    Parameters
    ----------
    export
        JSON export payload.

    Returns
    -------
    str
        CSV text preserving the brief, linked context, gaps, and provenance.
    """
    rows: list[dict[str, str]] = []

    def append_row(row_type: str, values: dict[str, str]) -> None:
        row = dict.fromkeys(CSV_COLUMNS, "")
        row["row_type"] = row_type
        row.update(values)
        rows.append(row)

    brief = export.brief
    append_row(
        "brief",
        {
            "record_id": brief.id,
            "title": brief.title,
            "detail": brief.summary,
            "location": brief.scope.geography,
            "issue_areas": "; ".join(brief.scope.issue_areas),
            "confidence_state": export.provenance.confidence_state,
            "review_status": export.provenance.review_status,
            "source_count": str(export.provenance.source_count),
            "entry_count": str(export.provenance.entry_count),
            "discovery_run_count": str(export.provenance.discovery_run_count),
            "updated_at": brief.updated_at,
        },
    )

    for entry in export.entries:
        append_row(
            "entry",
            {
                "record_id": entry.id,
                "name": entry.name,
                "record_type": entry.type,
                "location": ", ".join(item for item in [entry.city, entry.state] if item),
                "state": entry.state or "",
            },
        )

    for source in export.sources:
        append_row(
            "source",
            {
                "record_id": source.id,
                "title": source.title or "",
                "record_type": source.type,
                "url": source.url,
                "publication": source.publication or "",
                "published_date": source.published_date or "",
                "updated_at": source.ingested_at,
            },
        )

    for run in export.discovery_runs:
        append_row(
            "discovery_run",
            {
                "record_id": run.id,
                "location": run.location_query,
                "state": run.state,
                "issue_areas": "; ".join(run.issue_areas),
                "research_goal": run.research_goal,
                "status": run.status,
            },
        )

    for gap in brief.gaps:
        append_row(
            "gap",
            {
                "title": gap.label,
                "detail": gap.detail,
            },
        )

    append_row(
        "provenance",
        {
            "confidence_state": export.provenance.confidence_state,
            "review_status": export.provenance.review_status,
            "source_count": str(export.provenance.source_count),
            "entry_count": str(export.provenance.entry_count),
            "discovery_run_count": str(export.provenance.discovery_run_count),
        },
    )

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


async def _assert_visible_resource(
    conn: aiosqlite.Connection,
    *,
    resource_id: str,
    resource_type: str,
    org_id: str,
    not_found_detail: str,
) -> None:
    """Reject resource links that do not exist or belong to another workspace.

    Parameters
    ----------
    conn
        Database connection.
    resource_id
        Resource ID to validate.
    resource_type
        Ownership resource type.
    org_id
        Workspace creating the brief.
    not_found_detail
        HTTP detail when the resource is unavailable.
    """
    ownership = await OwnershipCRUD.get_ownership(conn, resource_id, resource_type)
    if ownership is not None and ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail=not_found_detail)


async def _validate_brief_links(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    req: OrgBriefCreateRequest,
) -> None:
    """Validate all linked records before creating a brief.

    Parameters
    ----------
    conn
        Database connection.
    org_id
        Workspace creating the brief.
    req
        Brief create request.
    """
    if not req.linked_entry_ids and not req.linked_source_ids and not req.linked_discovery_run_ids:
        raise HTTPException(
            status_code=400,
            detail="At least one linked entry, source, or discovery run is required.",
        )

    for entry_id in req.linked_entry_ids:
        if await EntryCRUD.get_by_id(conn, entry_id) is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        await _assert_visible_resource(
            conn,
            resource_id=entry_id,
            resource_type="entry",
            org_id=org_id,
            not_found_detail="Entry not found",
        )

    for source_id in req.linked_source_ids:
        if await SourceCRUD.get_by_id(conn, source_id) is None:
            raise HTTPException(status_code=404, detail="Source not found")
        await _assert_visible_resource(
            conn,
            resource_id=source_id,
            resource_type="source",
            org_id=org_id,
            not_found_detail="Source not found",
        )

    for run_id in req.linked_discovery_run_ids:
        if await DiscoveryRunCRUD.get_by_id(conn, run_id) is None:
            raise HTTPException(status_code=404, detail="Discovery run not found")
        await _assert_visible_resource(
            conn,
            resource_id=run_id,
            resource_type="discovery_run",
            org_id=org_id,
            not_found_detail="Discovery run not found",
        )


@router.get(
    "",
    response_model=OrgBriefCollectionResponse,
    summary="List private Atlas Briefs",
    operation_id="listOrgBriefs",
    tags=["org-briefs"],
)
async def list_org_briefs(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrgBriefCollectionResponse:
    """List private Atlas Brief artifacts owned by the workspace."""
    _verify_org_access(actor, org_id)
    briefs = await OrgBriefCRUD.list_by_org(db, org_id)
    apply_no_store_headers(response)
    return OrgBriefCollectionResponse(
        items=[_brief_response(brief) for brief in briefs], total=len(briefs)
    )


@router.post(
    "",
    response_model=OrgBriefResponse,
    status_code=201,
    summary="Create a private Atlas Brief",
    operation_id="createOrgBrief",
    tags=["org-briefs"],
)
async def create_org_brief(
    org_id: str,
    req: OrgBriefCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("workspace.export")),
) -> OrgBriefResponse:
    """Create a private Atlas Brief artifact inside a workspace."""
    _verify_org_access(actor, org_id)
    await _validate_brief_links(db, org_id=org_id, req=req)
    brief = await OrgBriefCRUD.create(
        db,
        org_id=org_id,
        title=req.title,
        scope=req.scope.model_dump(),
        summary=req.summary,
        linked_entry_ids=req.linked_entry_ids,
        linked_source_ids=req.linked_source_ids,
        linked_discovery_run_ids=req.linked_discovery_run_ids,
        confidence_summary=req.confidence_summary.model_dump(),
        gaps=[gap.model_dump() for gap in req.gaps],
        created_by=actor.user_id,
    )
    apply_no_store_headers(response)
    return _brief_response(brief)


@router.get(
    "/{brief_id}",
    response_model=OrgBriefResponse,
    summary="Get a private Atlas Brief",
    operation_id="getOrgBrief",
    tags=["org-briefs"],
)
async def get_org_brief(
    org_id: str,
    brief_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrgBriefResponse:
    """Get one private Atlas Brief artifact owned by the workspace."""
    _verify_org_access(actor, org_id)
    brief = await OrgBriefCRUD.get(db, brief_id)
    if brief is None or brief.org_id != org_id:
        raise HTTPException(status_code=404, detail="Brief not found")
    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=org_id,
            actor_id=actor.user_id,
            event_type="brief_opened",
            resource_type="brief",
            resource_id=brief_id,
        ),
    )
    apply_no_store_headers(response)
    return _brief_response(brief)


@router.patch(
    "/{brief_id}",
    response_model=OrgBriefResponse,
    summary="Update a private Atlas Brief",
    operation_id="updateOrgBrief",
    tags=["org-briefs"],
)
async def update_org_brief(  # noqa: PLR0913
    org_id: str,
    brief_id: str,
    req: OrgBriefUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("workspace.export")),
) -> OrgBriefResponse:
    """Update editable memo fields on one private Atlas Brief."""
    _verify_org_access(actor, org_id)
    brief = await OrgBriefCRUD.get(db, brief_id)
    if brief is None or brief.org_id != org_id:
        raise HTTPException(status_code=404, detail="Brief not found")

    if not req.model_fields_set:
        raise HTTPException(status_code=400, detail="At least one brief field is required.")

    updated = await OrgBriefCRUD.update(
        db,
        brief_id,
        title=req.title,
        summary=req.summary,
        confidence_summary=(
            req.confidence_summary.model_dump()
            if "confidence_summary" in req.model_fields_set and req.confidence_summary is not None
            else None
        ),
        gaps=(
            [gap.model_dump() for gap in req.gaps]
            if "gaps" in req.model_fields_set and req.gaps is not None
            else None
        ),
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Brief not found")
    apply_no_store_headers(response)
    return _brief_response(updated)


@router.get(
    "/{brief_id}/export",
    response_model=OrgBriefExportResponse,
    summary="Export a private Atlas Brief",
    operation_id="exportOrgBrief",
    tags=["org-briefs"],
)
async def export_org_brief(  # noqa: PLR0913
    org_id: str,
    brief_id: str,
    response: Response,
    export_format: Literal["json", "csv"] = Query("json", alias="format"),
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("workspace.export")),
) -> OrgBriefExportResponse | Response:
    """Export one private Atlas Brief with source receipts and linked context."""
    _verify_org_access(actor, org_id)
    brief = await OrgBriefCRUD.get(db, brief_id)
    if brief is None or brief.org_id != org_id:
        raise HTTPException(status_code=404, detail="Brief not found")
    await OrgUsageEventCRUD.record(
        db,
        OrgUsageEventRecord(
            org_id=org_id,
            actor_id=actor.user_id,
            event_type="brief_exported",
            resource_type="brief",
            resource_id=brief_id,
        ),
    )
    export = await _brief_export_response(db, brief)
    if export_format == "csv":
        csv_response = Response(
            content=_brief_export_csv(export),
            media_type="text/csv; charset=utf-8",
        )
        csv_response.headers["content-disposition"] = (
            f'attachment; filename="{_brief_csv_filename(export.brief)}"'
        )
        apply_no_store_headers(csv_response)
        return csv_response

    apply_no_store_headers(response)
    return export
