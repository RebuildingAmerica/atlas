"""Discovery schedule management endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.discovery.models import DiscoveryScheduleCRUD, DiscoveryScheduleModel
from atlas.domains.discovery.schemas import (
    DiscoveryScheduleCollectionResponse,
    DiscoveryScheduleCreateRequest,
    DiscoveryScheduleResponse,
    DiscoveryScheduleUpdateRequest,
)
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _validate_issue_areas(issue_areas: list[str]) -> None:
    """Raise when any requested issue area falls outside the Atlas taxonomy."""
    invalid = [ia for ia in issue_areas if ia not in ALL_ISSUE_SLUGS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid issue area(s): {', '.join(invalid)}")


def _schedule_to_response(schedule: DiscoveryScheduleModel) -> DiscoveryScheduleResponse:
    """Convert model to response."""
    return DiscoveryScheduleResponse(
        id=schedule.id,
        location_query=schedule.location_query,
        state=schedule.state,
        issue_areas=schedule.issue_areas,
        search_depth=schedule.search_depth,
        enabled=schedule.enabled,
        last_run_id=schedule.last_run_id,
        last_run_at=schedule.last_run_at,
        created_at=schedule.created_at,
        updated_at=schedule.updated_at,
    )


@router.get(
    "",
    response_model=DiscoveryScheduleCollectionResponse,
    summary="List discovery schedules",
    description="List configured discovery schedule targets.",
    operation_id="listDiscoverySchedules",
    tags=["discovery-schedules"],
)
async def list_schedules(
    response: Response,
    *,
    enabled_only: bool = Query(False, description="Only return enabled schedules"),
    limit: int = Query(100, ge=1, le=500),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryScheduleCollectionResponse:
    """List all discovery schedule targets."""
    _ = actor
    schedules = await DiscoveryScheduleCRUD.list(db, enabled_only=enabled_only, limit=limit)
    apply_no_store_headers(response)
    return DiscoveryScheduleCollectionResponse(
        items=[_schedule_to_response(s) for s in schedules],
        total=len(schedules),
    )


@router.post(
    "",
    response_model=DiscoveryScheduleResponse,
    status_code=201,
    summary="Create a discovery schedule",
    description="Add a new location and issue area target for scheduled discovery.",
    operation_id="createDiscoverySchedule",
    tags=["discovery-schedules"],
)
async def create_schedule(
    req: DiscoveryScheduleCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryScheduleResponse:
    """Create a new schedule target."""
    _ = actor
    _validate_issue_areas(req.issue_areas)
    schedule_id = await DiscoveryScheduleCRUD.create(
        db,
        location_query=req.location_query,
        state=req.state,
        issue_areas=req.issue_areas,
        search_depth=req.search_depth,
    )
    schedule = await DiscoveryScheduleCRUD.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=500, detail="Failed to create schedule")
    apply_no_store_headers(response)
    return _schedule_to_response(schedule)


@router.get(
    "/{schedule_id}",
    response_model=DiscoveryScheduleResponse,
    summary="Get a discovery schedule",
    description="Return one discovery schedule target by ID.",
    operation_id="getDiscoverySchedule",
    tags=["discovery-schedules"],
)
async def get_schedule(
    schedule_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryScheduleResponse:
    """Get a schedule target by ID."""
    _ = actor
    schedule = await DiscoveryScheduleCRUD.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    apply_no_store_headers(response)
    return _schedule_to_response(schedule)


@router.patch(
    "/{schedule_id}",
    response_model=DiscoveryScheduleResponse,
    summary="Update a discovery schedule",
    description="Partially update a discovery schedule target.",
    operation_id="updateDiscoverySchedule",
    tags=["discovery-schedules"],
)
async def update_schedule(
    schedule_id: str,
    req: DiscoveryScheduleUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryScheduleResponse:
    """Update a schedule target."""
    _ = actor
    existing = await DiscoveryScheduleCRUD.get_by_id(db, schedule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Schedule not found")

    updates = req.model_dump(exclude_unset=True)
    if "issue_areas" in updates:
        _validate_issue_areas(updates["issue_areas"])

    if updates:
        await DiscoveryScheduleCRUD.update(db, schedule_id, **updates)

    schedule = await DiscoveryScheduleCRUD.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=500, detail="Failed to reload schedule after update")
    apply_no_store_headers(response)
    return _schedule_to_response(schedule)


@router.delete(
    "/{schedule_id}",
    status_code=204,
    summary="Delete a discovery schedule",
    description="Remove a discovery schedule target.",
    operation_id="deleteDiscoverySchedule",
    tags=["discovery-schedules"],
)
async def delete_schedule(
    schedule_id: str,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete a schedule target."""
    _ = actor
    deleted = await DiscoveryScheduleCRUD.delete(db, schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Schedule not found")
