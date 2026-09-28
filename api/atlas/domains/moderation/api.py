"""Anonymous public flag endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access import AuthenticatedActor, require_actor
from atlas.domains.moderation.editorial_intake import (
    EditorialCandidateConflictError,
    EditorialCandidateCreateRequest,
    EditorialCandidateCreateResponse,
    EditorialProfileChangeConflictError,
    stage_editorial_candidate,
    stage_editorial_profile_change,
)
from atlas.domains.moderation.review_queue import ReviewConflictError, ReviewQueueCRUD
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


class WebsiteCandidateScanResponse(BaseModel):
    """Website proposals created for editorial review."""

    enqueued: int = Field(..., ge=0)
    review_item_ids: list[str] = Field(default_factory=list)


class FlagReceipt(BaseModel):
    """Public confirmation that excludes the private report contents."""

    id: str
    status: str
    created_at: str


class CorrectionInboxItemResponse(BaseModel):
    """Private profile report with the profile identity an editor needs."""

    id: str
    entity_id: str
    entity_name: str
    entity_slug: str | None
    entity_type: str
    reason: str
    note: str | None
    created_at: str


class CorrectionInboxResponse(BaseModel):
    """Paginated open reports; never exposed to anonymous callers."""

    items: list[CorrectionInboxItemResponse]
    total: int


class ModerationInboxItemResponse(BaseModel):
    """Private report with enough context to review its profile or source."""

    id: str
    target_type: Literal["entity", "source"]
    target_id: str
    target_name: str
    entity_slug: str | None
    entity_type: str | None
    source_url: str | None
    reason: str
    note: str | None
    created_at: str


class ModerationInboxResponse(BaseModel):
    """Paginated staff-only profile and source reports."""

    items: list[ModerationInboxItemResponse]
    total: int


async def require_moderation_editor(
    actor: AuthenticatedActor = Depends(require_actor),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedActor:
    """Keep reporter notes and publication decisions with named Atlas editors."""
    if actor.is_local:
        return actor
    allowed_emails = {
        email.strip().lower() for email in settings.operator_allowed_emails if email.strip()
    }
    if actor.auth_type != "internal" or actor.email.strip().lower() not in allowed_emails:
        raise HTTPException(status_code=403, detail="Editorial review requires Atlas staff.")
    return actor


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
    response_model=FlagReceipt,
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
) -> FlagReceipt:
    """Create an anonymous entity flag."""
    if await EntryCRUD.get_by_id(db, req.entity_id) is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    flag = await FlagCRUD.create_entity_flag(
        db, entity_id=req.entity_id, reason=req.reason, note=req.note
    )
    apply_no_store_headers(response)
    return FlagReceipt.model_validate(flag.__dict__)


@router.get(
    "/correction-inbox",
    response_model=ModerationInboxResponse,
    summary="List open profile and source reports for editors",
    operation_id="listModerationInbox",
    tags=["flags"],
)
async def list_moderation_inbox(
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
) -> ModerationInboxResponse:
    """Keep both kinds of private visitor report in the editor's work queue."""
    _ = actor
    items = await FlagCRUD.list_open_moderation_reports(db, limit=limit, offset=offset)
    total = await FlagCRUD.count_open_moderation_reports(db)
    apply_no_store_headers(response)
    return ModerationInboxResponse(
        items=[ModerationInboxItemResponse.model_validate(item.__dict__) for item in items],
        total=total,
    )


@router.get(
    "/entity-flags/inbox",
    response_model=CorrectionInboxResponse,
    summary="List open profile corrections for editors",
    operation_id="listCorrectionInbox",
    tags=["flags"],
)
async def list_correction_inbox(
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
) -> CorrectionInboxResponse:
    """Give an editor a private, oldest-first queue of reports requiring action."""
    _ = actor
    items = await FlagCRUD.list_open_corrections(db, limit=limit, offset=offset)
    total = await FlagCRUD.count_open_corrections(db)
    apply_no_store_headers(response)
    return CorrectionInboxResponse(
        items=[CorrectionInboxItemResponse.model_validate(item.__dict__) for item in items],
        total=total,
    )


@router.get(
    "/entity-flags",
    response_model=EntityFlagListResponse,
    summary="List entity flags",
    description="List anonymous flags that have been submitted for one Atlas entity.",
    operation_id="listEntityFlags",
    response_description="A paginated collection of entity flags.",
    tags=["flags"],
)
async def list_entity_flags(  # noqa: PLR0913 - FastAPI dependency parameters
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    entity_id: str = Query(...),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityFlagListResponse:
    """List flags for one entity."""
    _ = actor
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
    actor: AuthenticatedActor = Depends(require_moderation_editor),
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
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Mark one entity flag dismissed."""
    _ = actor
    flag = await _update_entity_flag_status(db, flag_id, status="reviewed")
    apply_no_store_headers(response)
    return flag


@router.post(
    "/source-flags",
    response_model=FlagReceipt,
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
) -> FlagReceipt:
    """Create an anonymous source flag."""
    if await SourceCRUD.get_by_id(db, req.source_id) is None:
        raise HTTPException(status_code=404, detail="Source not found")
    flag = await FlagCRUD.create_source_flag(
        db, source_id=req.source_id, reason=req.reason, note=req.note
    )
    apply_no_store_headers(response)
    return FlagReceipt.model_validate(flag.__dict__)


@router.get(
    "/source-flags",
    response_model=SourceFlagListResponse,
    summary="List source flags",
    description="List anonymous flags that have been submitted for one Atlas source.",
    operation_id="listSourceFlags",
    response_description="A paginated collection of source flags.",
    tags=["flags"],
)
async def list_source_flags(  # noqa: PLR0913 - FastAPI dependency parameters
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    source_id: str = Query(...),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> SourceFlagListResponse:
    """List flags for one source."""
    _ = actor
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
    actor: AuthenticatedActor = Depends(require_moderation_editor),
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
    actor: AuthenticatedActor = Depends(require_moderation_editor),
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
    summary="List pending discovery reviews",
    description="List publication holds and proposed edits to public profiles.",
    operation_id="listReviewQueue",
    response_description="A collection of pending review-queue items.",
    tags=["moderation"],
)
async def list_review_queue(
    response: Response,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    actor: AuthenticatedActor = Depends(require_moderation_editor),
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
    "/review-queue/editorial-candidates",
    response_model=EditorialCandidateCreateResponse,
    status_code=201,
    summary="Stage an official-source organization for editorial review",
    operation_id="createEditorialCandidate",
    tags=["moderation"],
)
async def create_editorial_candidate(
    request: EditorialCandidateCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EditorialCandidateCreateResponse:
    """Keep a researched organization private until an editor publishes it."""
    _ = actor
    try:
        candidate = await stage_editorial_candidate(db, request)
    except EditorialCandidateConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "entity_id": exc.entity_id},
        ) from exc
    apply_no_store_headers(response)
    return candidate


@router.post(
    "/review-queue/editorial-profiles/{entity_id}/changes",
    response_model=EditorialCandidateCreateResponse,
    status_code=202,
    summary="Stage a sourced correction to a published organization",
    operation_id="stageEditorialProfileChange",
    tags=["moderation"],
)
async def create_editorial_profile_change(
    entity_id: str,
    request: EditorialCandidateCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EditorialCandidateCreateResponse:
    """Keep the current public facts in place until an editor reviews the change."""
    _ = actor
    try:
        staged = await stage_editorial_profile_change(db, entity_id, request)
    except EditorialProfileChangeConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    apply_no_store_headers(response)
    return staged


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
    actor: AuthenticatedActor = Depends(require_moderation_editor),
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
    "/review-queue/website-candidate-scan",
    response_model=WebsiteCandidateScanResponse,
    summary="Prepare organization website candidates for review",
    description="Stage one linked organization-site source as a website proposal without publishing it.",
    operation_id="scanWebsiteCandidates",
    tags=["moderation"],
)
async def scan_website_candidates(
    response: Response,
    city: str = Query(..., min_length=1),
    state: str = Query(..., min_length=2, max_length=2),
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    db: aiosqlite.Connection = Depends(get_db),
) -> WebsiteCandidateScanResponse:
    """Queue public organization site URLs for an editor to confirm."""
    _ = actor
    review_item_ids = await ReviewQueueCRUD.enqueue_website_candidates(db, city=city, state=state)
    apply_no_store_headers(response)
    return WebsiteCandidateScanResponse(
        enqueued=len(review_item_ids), review_item_ids=review_item_ids
    )


@router.post(
    "/review-queue/{item_id}/approve",
    response_model=ReviewQueueItemResponse,
    summary="Approve a discovery review item",
    description="Publish a held record or apply a proposed public-profile change.",
    operation_id="approveReviewQueueItem",
    response_description="The approved review-queue item.",
    tags=["moderation"],
)
async def approve_review_queue_item(
    item_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
    db: aiosqlite.Connection = Depends(get_db),
) -> ReviewQueueItemResponse:
    """Approve a held record and publish its entry."""
    if await ReviewQueueCRUD.get_by_id(db, item_id) is None:
        raise HTTPException(status_code=404, detail="Review item not found")
    try:
        await ReviewQueueCRUD.approve(db, item_id, reviewed_by=actor.email)
    except ReviewConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    item = await ReviewQueueCRUD.get_by_id(db, item_id)
    assert item is not None, "review item existed moments ago"
    apply_no_store_headers(response)
    return ReviewQueueItemResponse.model_validate(item.__dict__)


@router.post(
    "/review-queue/{item_id}/reject",
    response_model=ReviewQueueItemResponse,
    summary="Reject a discovery review item",
    description="Leave a held record unpublished or keep the current public-profile facts.",
    operation_id="rejectReviewQueueItem",
    response_description="The rejected review-queue item.",
    tags=["moderation"],
)
async def reject_review_queue_item(
    item_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_moderation_editor),
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
