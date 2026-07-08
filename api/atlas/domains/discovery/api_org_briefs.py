"""Org-scoped private Atlas Brief endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.platform.http.cache import apply_no_store_headers

from .api_org_briefs_models import (
    OrgBriefCollectionResponse,
    OrgBriefCreateRequest,
    OrgBriefExportResponse,
    OrgBriefResponse,
    OrgBriefUpdateRequest,
)
from .api_org_briefs_support import (
    _brief_csv_filename,
    _brief_export_csv,
    _brief_export_response,
    _brief_response,
    _validate_brief_links,
    _verify_org_access,
    get_db,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]


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
