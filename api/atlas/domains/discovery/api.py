"""Discovery run endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
    run_discovery_pipeline_for_run,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import (
    DiscoveryRunCollectionResponse,
    DiscoveryRunResponse,
    DiscoveryRunStartRequest,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.discovery.models import DiscoveryRunModel

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url)
    try:
        yield conn
    finally:
        await conn.close()


@router.post(
    "",
    response_model=DiscoveryRunResponse,
    status_code=202,
    summary="Start a discovery run",
    description="Start an Atlas discovery pipeline run for a place and set of issue areas.",
    operation_id="createDiscoveryRun",
    response_description="The accepted discovery run.",
    tags=["discovery-runs"],
)
async def start_discovery_run(  # noqa: PLR0913
    req: DiscoveryRunStartRequest,
    background_tasks: BackgroundTasks,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    settings: Settings = Depends(get_settings),
    response: Response | None = None,
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunResponse:
    """
    Start a discovery run for a location and issue areas.

    Returns immediately with run ID. The pipeline runs asynchronously.
    """
    _ = actor
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

    pipeline_job = DiscoveryPipelineJob(
        run_id=run_id,
        location_query=req.location_query,
        state=req.state,
        issue_areas=req.issue_areas,
    )
    pipeline_credentials = DiscoveryPipelineCredentials(
        search_api_key=settings.search_api_key,
        anthropic_api_key=settings.anthropic_api_key,
    )
    if settings.discovery_inline:
        await run_discovery_pipeline_for_run(
            database_url=settings.database_url,
            job=pipeline_job,
            credentials=pipeline_credentials,
        )
        run = await DiscoveryRunCRUD.get_by_id(db, run_id)
        if not run:
            raise HTTPException(status_code=500, detail="Failed to refresh discovery run")
    else:
        background_tasks.add_task(
            run_discovery_pipeline_for_run,
            database_url=settings.database_url,
            job=pipeline_job,
            credentials=pipeline_credentials,
        )

    if response is not None:
        apply_no_store_headers(response)
    return _run_to_response(run)


@router.get(
    "",
    response_model=DiscoveryRunCollectionResponse,
    summary="List discovery runs",
    description="List Atlas discovery pipeline runs with optional state and status filters.",
    operation_id="listDiscoveryRuns",
    response_description="A paginated collection of discovery runs.",
    tags=["discovery-runs"],
)
async def list_discovery_runs(  # noqa: PLR0913
    state: str | None = Query(None, min_length=2, max_length=2),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    response: Response | None = None,
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunCollectionResponse:
    """
    List discovery runs with optional filtering.

    Query Parameters:
    - state: filter by state
    - status: running, completed, or failed
    - limit: results per page (default: 50, max: 500)
    - cursor: pagination cursor (default: 0)
    """
    try:
        _ = actor
        offset = max(int(cursor), 0) if cursor is not None else 0
        runs = await DiscoveryRunCRUD.list(
            db,
            state=state,
            status=status,
            limit=limit,
            offset=offset,
        )
        total = await DiscoveryRunCRUD.count(db, state=state, status=status)
        items = [_run_to_response(r).model_dump(mode="json") for r in runs]
        next_cursor = str(offset + limit) if offset + limit < total else None
        if response is not None:
            apply_no_store_headers(response)
        return DiscoveryRunCollectionResponse(items=items, total=total, next_cursor=next_cursor)
    except Exception:
        logger.exception(
            "Failed to list discovery runs",
            extra={
                "actor_auth_type": actor.auth_type,
                "actor_email": actor.email,
                "actor_user_id": actor.user_id,
                "cursor": cursor,
                "limit": limit,
                "state": state,
                "status": status,
            },
        )
        raise


@router.get(
    "/{run_id}",
    response_model=DiscoveryRunResponse,
    summary="Get a discovery run",
    description="Return one Atlas discovery run by ID.",
    operation_id="getDiscoveryRun",
    response_description="The requested discovery run.",
    tags=["discovery-runs"],
)
async def get_discovery_run(
    run_id: str,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    response: Response | None = None,
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunResponse:
    """Get a discovery run by ID."""
    _ = actor
    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")
    if response is not None:
        apply_no_store_headers(response)
    return _run_to_response(run)


def _run_to_response(run: DiscoveryRunModel) -> DiscoveryRunResponse:
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
