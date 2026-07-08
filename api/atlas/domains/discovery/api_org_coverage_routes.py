"""Org-scoped coverage target endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watch_events import OrgChangeEventCRUD, OrgCoverageStatusChange
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.discovery.coverage_targets import (
    CoverageTargetCRUD,
    CoverageTargetModel,
    CoverageTargetUpdate,
)
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.http.cache import apply_no_store_headers

from .api_org_coverage_imports import (
    _coverage_import_error_detail,
    _parse_coverage_target_import_csv,
    _validate_import_target_links,
)
from .api_org_coverage_models import (
    CoverageReportResponse,
    CoverageTargetCollectionResponse,
    CoverageTargetCreateRequest,
    CoverageTargetDetailResponse,
    CoverageTargetImportRequest,
    CoverageTargetImportResponse,
    CoverageTargetResponse,
    CoverageTargetUpdateRequest,
)
from .api_org_coverage_report import (
    _coverage_report_csv,
    _target_detail_response,
    _target_response,
    build_coverage_report_response,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


async def _validate_target_links(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    req: CoverageTargetCreateRequest,
) -> None:
    """Validate scope and links before creating a coverage target."""
    await _validate_target_fields(
        db,
        org_id=org_id,
        issue_areas=req.issue_areas,
        linked_discovery_run_ids=req.linked_discovery_run_ids,
        linked_entry_ids=req.linked_entry_ids,
    )


async def _validate_target_fields(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    issue_areas: list[str],
    linked_discovery_run_ids: list[str],
    linked_entry_ids: list[str],
) -> None:
    """Validate scope and links before storing a coverage target."""
    for issue_area in issue_areas:
        if issue_area not in ALL_ISSUE_SLUGS:
            raise HTTPException(status_code=400, detail=f"Invalid issue area: {issue_area}")

    for run_id in linked_discovery_run_ids:
        ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
        if ownership is None or ownership.org_id != org_id:
            raise HTTPException(status_code=404, detail="Discovery run not found")

    for entry_id in linked_entry_ids:
        entry = await EntryCRUD.get_by_id(db, entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")


def _target_update_input(
    target: CoverageTargetModel,
    req: CoverageTargetUpdateRequest,
) -> CoverageTargetUpdate:
    """Merge a partial update request with the current coverage target."""
    fields = req.model_fields_set
    gaps = (
        [gap.model_dump() for gap in req.gaps]
        if "gaps" in fields and req.gaps is not None
        else target.gaps
    )
    return CoverageTargetUpdate(
        name=req.name if req.name is not None else target.name,
        geography=req.geography if req.geography is not None else target.geography,
        issue_areas=req.issue_areas if req.issue_areas is not None else target.issue_areas,
        actor_types=req.actor_types if req.actor_types is not None else target.actor_types,
        source_types=req.source_types if req.source_types is not None else target.source_types,
        gaps=gaps,
        next_actions=req.next_actions if req.next_actions is not None else target.next_actions,
        linked_discovery_run_ids=(
            req.linked_discovery_run_ids
            if req.linked_discovery_run_ids is not None
            else target.linked_discovery_run_ids
        ),
        linked_entry_ids=(
            req.linked_entry_ids if req.linked_entry_ids is not None else target.linked_entry_ids
        ),
        last_reviewed_at=(
            req.last_reviewed_at if "last_reviewed_at" in fields else target.last_reviewed_at
        ),
        review_state=req.review_state if req.review_state is not None else target.review_state,
    )


@router.get(
    "/export",
    response_model=CoverageReportResponse,
    summary="Export workspace coverage targets",
    operation_id="exportOrgCoverageTargets",
    tags=["org-coverage-targets"],
)
async def export_org_coverage_targets(
    org_id: str,
    response: Response,
    export_format: Literal["json", "csv"] = Query("json", alias="format"),
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("workspace.export")),
) -> CoverageReportResponse | Response:
    """Export coverage targets as JSON or CSV report rows."""
    _verify_org_access(actor, org_id)
    targets = await CoverageTargetCRUD.list_by_org(db, org_id)
    report = build_coverage_report_response(org_id=org_id, targets=targets)
    if export_format == "csv":
        csv_response = Response(
            content=_coverage_report_csv(report),
            media_type="text/csv; charset=utf-8",
        )
        csv_response.headers["content-disposition"] = (
            f'attachment; filename="atlas-coverage-{org_id}.csv"'
        )
        apply_no_store_headers(csv_response)
        return csv_response

    apply_no_store_headers(response)
    return report


@router.post(
    "/import",
    response_model=CoverageTargetImportResponse,
    status_code=201,
    summary="Import workspace coverage targets",
    operation_id="importOrgCoverageTargets",
    tags=["org-coverage-targets"],
)
async def import_org_coverage_targets(
    org_id: str,
    req: CoverageTargetImportRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
) -> CoverageTargetImportResponse:
    """Import coverage targets from a customer onboarding CSV."""
    _verify_org_access(actor, org_id)
    parsed_rows, errors = _parse_coverage_target_import_csv(req.csv_text)
    errors.extend(await _validate_import_target_links(db, org_id=org_id, parsed_rows=parsed_rows))
    if errors:
        raise HTTPException(status_code=400, detail=_coverage_import_error_detail(errors))

    created: list[CoverageTargetResponse] = []
    for parsed_row in parsed_rows:
        target_request = parsed_row.request
        target = await CoverageTargetCRUD.create(
            db,
            org_id=org_id,
            name=target_request.name,
            geography=target_request.geography,
            issue_areas=target_request.issue_areas,
            actor_types=target_request.actor_types,
            source_types=target_request.source_types,
            gaps=[gap.model_dump() for gap in target_request.gaps],
            next_actions=target_request.next_actions,
            linked_discovery_run_ids=target_request.linked_discovery_run_ids,
            linked_entry_ids=target_request.linked_entry_ids,
            created_by=actor.user_id,
            last_reviewed_at=target_request.last_reviewed_at,
            review_state=target_request.review_state,
        )
        created.append(_target_response(target))

    apply_no_store_headers(response)
    return CoverageTargetImportResponse(imported=len(created), created=created)


@router.get(
    "/{target_id}",
    response_model=CoverageTargetDetailResponse,
    summary="Get workspace coverage target detail",
    operation_id="getOrgCoverageTarget",
    tags=["org-coverage-targets"],
)
async def get_org_coverage_target(
    org_id: str,
    target_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> CoverageTargetDetailResponse:
    """Return a workspace coverage target with linked evidence for review."""
    _verify_org_access(actor, org_id)
    target = await CoverageTargetCRUD.get(db, target_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(status_code=404, detail="Coverage target not found")

    apply_no_store_headers(response)
    return await _target_detail_response(db, target)


@router.patch(
    "/{target_id}",
    response_model=CoverageTargetResponse,
    summary="Update a workspace coverage target",
    operation_id="updateOrgCoverageTarget",
    tags=["org-coverage-targets"],
)
async def update_org_coverage_target(  # noqa: PLR0913
    org_id: str,
    target_id: str,
    req: CoverageTargetUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
) -> CoverageTargetResponse:
    """Update a coverage target and notify watched workspaces of status changes."""
    _verify_org_access(actor, org_id)
    if not req.model_fields_set:
        raise HTTPException(
            status_code=400, detail="At least one coverage target field is required."
        )

    target = await CoverageTargetCRUD.get(db, target_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(status_code=404, detail="Coverage target not found")

    update_input = _target_update_input(target, req)
    await _validate_target_fields(
        db,
        org_id=org_id,
        issue_areas=update_input.issue_areas,
        linked_discovery_run_ids=update_input.linked_discovery_run_ids,
        linked_entry_ids=update_input.linked_entry_ids,
    )
    updated = await CoverageTargetCRUD.update(db, target_id, update_input)
    if updated is None:
        raise HTTPException(status_code=404, detail="Coverage target not found")

    await OrgChangeEventCRUD.record_coverage_status_event(
        db,
        OrgCoverageStatusChange(
            org_id=org_id,
            target_id=target_id,
            target_name=updated.name,
            previous_status=target.status,
            new_status=updated.status,
        ),
    )
    if target.status != "covered" and updated.status == "covered":
        await OrgUsageEventCRUD.record(
            db,
            OrgUsageEventRecord(
                org_id=org_id,
                actor_id=actor.user_id,
                event_type="coverage_gap_closed",
                resource_type="coverage_target",
                resource_id=target_id,
            ),
        )
    apply_no_store_headers(response)
    return _target_response(updated)


@router.get(
    "",
    response_model=CoverageTargetCollectionResponse,
    summary="List workspace coverage targets",
    operation_id="listOrgCoverageTargets",
    tags=["org-coverage-targets"],
)
async def list_org_coverage_targets(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> CoverageTargetCollectionResponse:
    """List coverage targets owned by a workspace."""
    _verify_org_access(actor, org_id)
    targets = await CoverageTargetCRUD.list_by_org(db, org_id)
    apply_no_store_headers(response)
    return CoverageTargetCollectionResponse(
        items=[_target_response(target) for target in targets],
        total=len(targets),
    )


@router.post(
    "",
    response_model=CoverageTargetResponse,
    status_code=201,
    summary="Create a workspace coverage target",
    operation_id="createOrgCoverageTarget",
    tags=["org-coverage-targets"],
)
async def create_org_coverage_target(
    org_id: str,
    req: CoverageTargetCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
) -> CoverageTargetResponse:
    """Create a coverage target with status derived from linked evidence."""
    _verify_org_access(actor, org_id)
    await _validate_target_links(db, org_id=org_id, req=req)
    target = await CoverageTargetCRUD.create(
        db,
        org_id=org_id,
        name=req.name,
        geography=req.geography,
        issue_areas=req.issue_areas,
        actor_types=req.actor_types,
        source_types=req.source_types,
        gaps=[gap.model_dump() for gap in req.gaps],
        next_actions=req.next_actions,
        linked_discovery_run_ids=req.linked_discovery_run_ids,
        linked_entry_ids=req.linked_entry_ids,
        created_by=actor.user_id,
        last_reviewed_at=req.last_reviewed_at,
        review_state=req.review_state,
    )
    apply_no_store_headers(response)
    return _target_response(target)
