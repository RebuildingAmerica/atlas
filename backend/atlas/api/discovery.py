"""Discovery run endpoints."""

import logging
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query

from atlas.config import Settings, get_settings
from atlas.models import DiscoveryRunCRUD, get_db_connection
from atlas.schemas import DiscoveryRunResponse, DiscoveryRunStartRequest
from atlas.taxonomy import ALL_ISSUE_SLUGS

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


async def get_db(settings: Settings = Depends(get_settings)) -> AsyncGenerator:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url)
    try:
        yield conn
    finally:
        await conn.close()


@router.post("/run", response_model=DiscoveryRunResponse, status_code=202)
async def start_discovery_run(
    req: DiscoveryRunStartRequest,
    db: AsyncGenerator = Depends(get_db),
) -> DiscoveryRunResponse:
    """
    Start a discovery run for a location and issue areas.

    Returns immediately with run ID. The pipeline runs asynchronously.
    """
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

    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=500, detail="Failed to create discovery run")

    return _run_to_response(run)


@router.get("/runs", response_model=list[DiscoveryRunResponse])
async def list_discovery_runs(
    state: str | None = Query(None, min_length=2, max_length=2),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncGenerator = Depends(get_db),
) -> list[DiscoveryRunResponse]:
    """
    List discovery runs with optional filtering.

    Query Parameters:
    - state: filter by state
    - status: running, completed, or failed
    - limit: results per page (default: 50, max: 500)
    - offset: pagination offset (default: 0)
    """
    runs = await DiscoveryRunCRUD.list(
        db,
        state=state,
        status=status,
        limit=limit,
        offset=offset,
    )
    return [_run_to_response(r) for r in runs]


@router.get("/runs/{run_id}", response_model=DiscoveryRunResponse)
async def get_discovery_run(
    run_id: str,
    db: AsyncGenerator = Depends(get_db),
) -> DiscoveryRunResponse:
    """Get a discovery run by ID."""
    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")
    return _run_to_response(run)


def _run_to_response(run: any) -> DiscoveryRunResponse:
    """Convert DiscoveryRunModel to DiscoveryRunResponse."""
    return DiscoveryRunResponse(
        id=run.id,
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
