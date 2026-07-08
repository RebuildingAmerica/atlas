"""Discovery run endpoints."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
)
from atlas.domains.discovery.schemas import (
    DiscoveryRunCancelResponse,
)
from atlas.models import DiscoveryRunCRUD
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import (
    DiscoveryRunCollectionResponse,
    DiscoveryRunResponse,
)

from .api_helpers import _run_to_response, get_db

if TYPE_CHECKING:
    import aiosqlite


logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


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
    response: Response,
    *,
    state: str | None = Query(None, min_length=2, max_length=2),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
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
    response: Response = Response(),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunResponse:
    """Get a discovery run by ID."""
    _ = actor
    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")
    apply_no_store_headers(response)
    return _run_to_response(run)


@router.post(
    "/{run_id}/cancel",
    response_model=DiscoveryRunCancelResponse,
    summary="Cancel a discovery run",
    description="Cancel every queued, claimed, or running job belonging to a discovery run.",
    operation_id="cancelDiscoveryRun",
    tags=["discovery-runs"],
)
async def cancel_discovery_run(
    run_id: str,
    response: Response = Response(),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunCancelResponse:
    """Cancel a discovery run's outstanding jobs.

    Returns the number of non-terminal jobs that were moved to ``cancelled``;
    already-finished jobs are left untouched. Returns 404 if the run is unknown.
    """
    _ = actor
    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")
    cancelled = await DiscoveryJobCRUD.cancel_run_jobs(db, run_id)
    apply_no_store_headers(response)
    return DiscoveryRunCancelResponse(run_id=run_id, jobs_cancelled=cancelled)
