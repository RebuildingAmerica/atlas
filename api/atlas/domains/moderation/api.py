"""Anonymous public flag endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD, FlagCRUD, SourceCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import (
    EntityFlagCreateRequest,
    EntityFlagListResponse,
    FlagResponse,
    ReviewQueueItemResponse,
    ReviewQueueListResponse,
    SourceFlagCreateRequest,
    SourceFlagListResponse,
)

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter()

__all__ = ["router"]


class SourceStalenessReviewScanResponse(BaseModel):
    """Review items created by a stale-source scan."""

    enqueued: int = Field(..., ge=0)
    review_item_ids: list[str] = Field(default_factory=list)


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


@router.post(
    "/entity-flags",
    response_model=FlagResponse,
    status_code=201,
    summary="Create an entity flag",
    description="Submit an anonymous flag for an Atlas entity that looks stale or incorrect.",
    operation_id="createEntityFlag",
    response_description="The newly created entity flag.",
    tags=["flags"],
)
async def create_entity_flag(
    req: EntityFlagCreateRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Create an anonymous entity flag."""
    if await EntryCRUD.get_by_id(db, req.entity_id) is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    flag = await FlagCRUD.create_entity_flag(
        db, entity_id=req.entity_id, reason=req.reason, note=req.note
    )
    apply_no_store_headers(response)
    return FlagResponse.model_validate(flag.__dict__)


@router.get(
    "/entity-flags",
    response_model=EntityFlagListResponse,
    summary="List entity flags",
    description="List anonymous flags that have been submitted for one Atlas entity.",
    operation_id="listEntityFlags",
    response_description="A paginated collection of entity flags.",
    tags=["flags"],
)
async def list_entity_flags(
    response: Response,
    entity_id: str = Query(...),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityFlagListResponse:
    """List flags for one entity."""
    offset = max(int(cursor), 0) if cursor is not None else 0
    items = [
        FlagResponse.model_validate(flag.__dict__)
        for flag in await FlagCRUD.list_entity_flags(
            db, entity_id=entity_id, limit=limit, offset=offset
        )
    ]
    total = await FlagCRUD.count_entity_flags(db, entity_id=entity_id)
    next_cursor = str(offset + limit) if offset + limit < total else None
    apply_no_store_headers(response)
    return EntityFlagListResponse(items=items, total=total, next_cursor=next_cursor)


async def _update_entity_flag_status(
    db: aiosqlite.Connection,
    flag_id: str,
    *,
    status: str,
) -> FlagResponse:
    """Update one entity flag status or raise a 404."""
    if await FlagCRUD.get_entity_flag(db, flag_id) is None:
        raise HTTPException(status_code=404, detail="Entity flag not found")
    flag = await FlagCRUD.update_entity_flag_status(db, flag_id, status=status)
    assert flag is not None, "entity flag existed moments before status update"
    return FlagResponse.model_validate(flag.__dict__)


@router.post(
    "/entity-flags/{flag_id}/resolve",
    response_model=FlagResponse,
    summary="Resolve an entity flag",
    description="Close an entity correction, dispute, or sensitive-person report as resolved.",
    operation_id="resolveEntityFlag",
    response_description="The resolved entity flag.",
    tags=["flags"],
)
async def resolve_entity_flag(
    flag_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Mark one entity flag resolved."""
    _ = actor
    flag = await _update_entity_flag_status(db, flag_id, status="resolved")
    apply_no_store_headers(response)
    return flag


@router.post(
    "/entity-flags/{flag_id}/dismiss",
    response_model=FlagResponse,
    summary="Dismiss an entity flag",
    description="Close an entity correction, dispute, or sensitive-person report as dismissed.",
    operation_id="dismissEntityFlag",
    response_description="The dismissed entity flag.",
    tags=["flags"],
)
async def dismiss_entity_flag(
    flag_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Mark one entity flag dismissed."""
    _ = actor
    flag = await _update_entity_flag_status(db, flag_id, status="reviewed")
    apply_no_store_headers(response)
    return flag


@router.post(
    "/source-flags",
    response_model=FlagResponse,
    status_code=201,
    summary="Create a source flag",
    description="Submit an anonymous flag for an Atlas source record that looks stale or incorrect.",
    operation_id="createSourceFlag",
    response_description="The newly created source flag.",
    tags=["flags"],
)
async def create_source_flag(
    req: SourceFlagCreateRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Create an anonymous source flag."""
    if await SourceCRUD.get_by_id(db, req.source_id) is None:
        raise HTTPException(status_code=404, detail="Source not found")
    flag = await FlagCRUD.create_source_flag(
        db, source_id=req.source_id, reason=req.reason, note=req.note
    )
    apply_no_store_headers(response)
    return FlagResponse.model_validate(flag.__dict__)


@router.get(
    "/source-flags",
    response_model=SourceFlagListResponse,
    summary="List source flags",
    description="List anonymous flags that have been submitted for one Atlas source.",
    operation_id="listSourceFlags",
    response_description="A paginated collection of source flags.",
    tags=["flags"],
)
async def list_source_flags(
    response: Response,
    source_id: str = Query(...),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> SourceFlagListResponse:
    """List flags for one source."""
    offset = max(int(cursor), 0) if cursor is not None else 0
    items = [
        FlagResponse.model_validate(flag.__dict__)
        for flag in await FlagCRUD.list_source_flags(
            db, source_id=source_id, limit=limit, offset=offset
        )
    ]
    total = await FlagCRUD.count_source_flags(db, source_id=source_id)
    next_cursor = str(offset + limit) if offset + limit < total else None
    apply_no_store_headers(response)
    return SourceFlagListResponse(items=items, total=total, next_cursor=next_cursor)


async def _update_source_flag_status(
    db: aiosqlite.Connection,
    flag_id: str,
    *,
    status: str,
) -> FlagResponse:
    """Update one source flag status or raise a 404."""
    if await FlagCRUD.get_source_flag(db, flag_id) is None:
        raise HTTPException(status_code=404, detail="Source flag not found")
    flag = await FlagCRUD.update_source_flag_status(db, flag_id, status=status)
    assert flag is not None, "source flag existed moments before status update"
    return FlagResponse.model_validate(flag.__dict__)


@router.post(
    "/source-flags/{flag_id}/resolve",
    response_model=FlagResponse,
    summary="Resolve a source flag",
    description="Close a source correction or dispute as resolved.",
    operation_id="resolveSourceFlag",
    response_description="The resolved source flag.",
    tags=["flags"],
)
async def resolve_source_flag(
    flag_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Mark one source flag resolved."""
    _ = actor
    flag = await _update_source_flag_status(db, flag_id, status="resolved")
    apply_no_store_headers(response)
    return flag


@router.post(
    "/source-flags/{flag_id}/dismiss",
    response_model=FlagResponse,
    summary="Dismiss a source flag",
    description="Close a source correction or dispute as dismissed.",
    operation_id="dismissSourceFlag",
    response_description="The dismissed source flag.",
    tags=["flags"],
)
async def dismiss_source_flag(
    flag_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Mark one source flag dismissed."""
    _ = actor
    flag = await _update_source_flag_status(db, flag_id, status="reviewed")
    apply_no_store_headers(response)
    return flag


@router.get(
    "/review-queue",
    response_model=ReviewQueueListResponse,
    summary="List held discovery records",
    description="List discovered records held back from the public directory for review.",
    operation_id="listReviewQueue",
    response_description="A collection of pending review-queue items.",
    tags=["moderation"],
)
async def list_review_queue(
    response: Response,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ReviewQueueListResponse:
    """List pending review-queue items oldest-first."""
    _ = actor
    items = [
        ReviewQueueItemResponse.model_validate(item.__dict__)
        for item in await ReviewQueueCRUD.list_pending(db, limit=limit, offset=offset)
    ]
    total = await ReviewQueueCRUD.count_pending(db)
    apply_no_store_headers(response)
    return ReviewQueueListResponse(items=items, total=total)


@router.post(
    "/review-queue/source-staleness-scan",
    response_model=SourceStalenessReviewScanResponse,
    summary="Scan public records for stale source review",
    description="Enqueue public records whose source receipts need freshness review.",
    operation_id="scanSourceStalenessReviewQueue",
    response_description="Review items created by the stale-source scan.",
    tags=["moderation"],
)
async def scan_source_staleness_review_queue(
    response: Response,
    org_id: str | None = Query(None),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> SourceStalenessReviewScanResponse:
    """Enqueue stale public records for operator review."""
    _ = actor
    review_item_ids = await ReviewQueueCRUD.enqueue_stale_public_sources(db, org_id=org_id)
    apply_no_store_headers(response)
    return SourceStalenessReviewScanResponse(
        enqueued=len(review_item_ids),
        review_item_ids=review_item_ids,
    )


@router.post(
    "/review-queue/{item_id}/approve",
    response_model=ReviewQueueItemResponse,
    summary="Approve a held discovery record",
    description="Publish a held record to the public directory and close its review item.",
    operation_id="approveReviewQueueItem",
    response_description="The approved review-queue item.",
    tags=["moderation"],
)
async def approve_review_queue_item(
    item_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ReviewQueueItemResponse:
    """Approve a held record and publish its entry."""
    if await ReviewQueueCRUD.get_by_id(db, item_id) is None:
        raise HTTPException(status_code=404, detail="Review item not found")
    await ReviewQueueCRUD.approve(db, item_id, reviewed_by=actor.email)
    item = await ReviewQueueCRUD.get_by_id(db, item_id)
    assert item is not None, "review item existed moments ago"
    apply_no_store_headers(response)
    return ReviewQueueItemResponse.model_validate(item.__dict__)


@router.post(
    "/review-queue/{item_id}/reject",
    response_model=ReviewQueueItemResponse,
    summary="Reject a held discovery record",
    description="Leave a held record out of the public directory and close its review item.",
    operation_id="rejectReviewQueueItem",
    response_description="The rejected review-queue item.",
    tags=["moderation"],
)
async def reject_review_queue_item(
    item_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ReviewQueueItemResponse:
    """Reject a held record and keep its entry inactive."""
    if await ReviewQueueCRUD.get_by_id(db, item_id) is None:
        raise HTTPException(status_code=404, detail="Review item not found")
    await ReviewQueueCRUD.reject(db, item_id, reviewed_by=actor.email)
    item = await ReviewQueueCRUD.get_by_id(db, item_id)
    assert item is not None, "review item existed moments ago"
    apply_no_store_headers(response)
    return ReviewQueueItemResponse.model_validate(item.__dict__)
