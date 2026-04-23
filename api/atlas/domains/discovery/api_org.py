"""Org-scoped private discovery run endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.capabilities import enforce_limit, require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.models import DiscoveryRunCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor
    from atlas.domains.discovery.models import DiscoveryRunModel

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


# --- Request/Response schemas ---


class OrgDiscoveryRunStartRequest(BaseModel):
    """Request to start an org-scoped private discovery run."""

    location_query: str = Field(
        ...,
        description="Location query (e.g., 'Kansas City, MO')",
        min_length=1,
    )
    state: str = Field(
        ...,
        description="2-letter state code",
        min_length=2,
        max_length=2,
    )
    issue_areas: list[str] = Field(
        ...,
        description="List of issue area slugs to query",
        min_length=1,
    )


class OrgDiscoveryRunResponse(BaseModel):
    """Org-scoped discovery run response model."""

    id: str = Field(..., description="Discovery run ID")
    org_id: str = Field(..., description="Owning organization ID")
    location_query: str = Field(..., description="Location query")
    state: str = Field(..., description="State code")
    issue_areas: list[str] = Field(..., description="Issue areas queried")
    queries_generated: int = Field(..., description="Search queries generated")
    sources_fetched: int = Field(..., description="Sources fetched")
    sources_processed: int = Field(..., description="Sources processed")
    entries_extracted: int = Field(..., description="Entries extracted")
    entries_after_dedup: int = Field(..., description="Entries after deduplication")
    entries_confirmed: int = Field(..., description="Entries confirmed")
    started_at: str = Field(..., description="Start timestamp")
    completed_at: str | None = Field(None, description="Completion timestamp")
    status: str = Field(..., description="Status (running, completed, failed)")
    error_message: str | None = Field(None, description="Error message if failed")
    created_at: str = Field(..., description="Creation timestamp")


class OrgDiscoveryRunCollectionResponse(BaseModel):
    """Collection response for org discovery runs."""

    items: list[OrgDiscoveryRunResponse] = Field(..., description="Discovery runs")
    total: int = Field(..., description="Total count")
    next_cursor: str | None = Field(None, description="Next pagination cursor")


# --- Dependencies ---


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(
            status_code=403,
            detail="Access denied: org_id mismatch",
        )


def _run_to_org_response(run: DiscoveryRunModel, org_id: str) -> OrgDiscoveryRunResponse:
    """Convert DiscoveryRunModel to OrgDiscoveryRunResponse."""
    return OrgDiscoveryRunResponse(
        id=run.id,
        org_id=org_id,
        location_query=run.location_query,
        state=run.state,
        issue_areas=run.issue_areas,
        queries_generated=run.queries_generated,
        sources_fetched=run.sources_fetched,
        sources_processed=run.sources_processed,
        entries_extracted=run.entries_extracted,
        entries_after_dedup=run.entries_after_dedup,
        entries_confirmed=run.entries_confirmed,
        started_at=run.started_at,
        completed_at=run.completed_at,
        status=run.status,
        error_message=run.error_message,
        created_at=run.created_at,
    )


# --- Endpoints ---


@router.get(
    "",
    response_model=OrgDiscoveryRunCollectionResponse,
    summary="List org's private discovery runs",
    operation_id="listOrgDiscoveryRuns",
    tags=["org-discovery-runs"],
)
async def list_org_discovery_runs(  # noqa: PLR0913
    org_id: str,
    response: Response,
    status: str | None = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None, description="Pagination cursor"),
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrgDiscoveryRunCollectionResponse:
    """List private discovery runs owned by the org."""
    _verify_org_access(actor, org_id)

    ownership_records = await OwnershipCRUD.list_by_org(
        db, org_id, resource_type="discovery_run", visibility="private"
    )
    run_ids = [record.resource_id for record in ownership_records]

    if not run_ids:
        apply_no_store_headers(response)
        return OrgDiscoveryRunCollectionResponse(items=[], total=0, next_cursor=None)

    # Fetch all runs and apply filters
    runs: list[DiscoveryRunModel] = []
    for run_id in run_ids:
        run = await DiscoveryRunCRUD.get_by_id(db, run_id)
        if run is not None:
            if status is not None and run.status != status:
                continue
            runs.append(run)

    # Sort by started_at descending
    runs.sort(key=lambda r: r.started_at, reverse=True)
    total = len(runs)

    # Paginate
    offset = max(int(cursor), 0) if cursor is not None else 0
    paginated = runs[offset : offset + limit]
    next_cursor = str(offset + limit) if offset + limit < total else None

    apply_no_store_headers(response)
    return OrgDiscoveryRunCollectionResponse(
        items=[_run_to_org_response(r, org_id) for r in paginated],
        total=total,
        next_cursor=next_cursor,
    )


@router.post(
    "",
    response_model=OrgDiscoveryRunResponse,
    status_code=202,
    summary="Start a private discovery run",
    operation_id="createOrgDiscoveryRun",
    tags=["org-discovery-runs"],
)
async def start_org_discovery_run(
    org_id: str,
    req: OrgDiscoveryRunStartRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
    _run_limit: int | None = Depends(enforce_limit("research_runs_per_month")),
) -> OrgDiscoveryRunResponse:
    """Start a private discovery run for the org (record only, no pipeline execution)."""
    _verify_org_access(actor, org_id)

    # Validate issue areas
    for issue_area in req.issue_areas:
        if issue_area not in ALL_ISSUE_SLUGS:
            raise HTTPException(status_code=400, detail=f"Invalid issue area: {issue_area}")

    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query=req.location_query,
        state=req.state,
        issue_areas=req.issue_areas,
    )

    await OwnershipCRUD.create_ownership(
        db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id=org_id,
        visibility="private",
        created_by=actor.user_id,
    )

    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=500, detail="Failed to create discovery run")

    apply_no_store_headers(response)
    return _run_to_org_response(run, org_id)


@router.get(
    "/{run_id}",
    response_model=OrgDiscoveryRunResponse,
    summary="Get a private discovery run",
    operation_id="getOrgDiscoveryRun",
    tags=["org-discovery-runs"],
)
async def get_org_discovery_run(
    org_id: str,
    run_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrgDiscoveryRunResponse:
    """Get details of a private discovery run owned by the org."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Discovery run not found")

    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")

    apply_no_store_headers(response)
    return _run_to_org_response(run, org_id)
