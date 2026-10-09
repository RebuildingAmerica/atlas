"""Editorial takedowns: hide a profile on request, and restore it later."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from atlas.domains.access import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)
from atlas.domains.moderation.api import get_db
from atlas.domains.moderation.takedowns import (
    EntryTakedown,
    EntryTakedownCRUD,
    TakedownConflictError,
)
from atlas.platform.authz import Action, require_action
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter()

__all__ = ["router"]

PROFILE_NOT_FOUND_DETAIL = "No profile has that address."
TAKEDOWN_NOT_FOUND_DETAIL = "Takedown not found."


class TakedownCreateRequest(BaseModel):
    """Which profile to take down, and why."""

    slug: str = Field(..., min_length=1, max_length=200, description="The profile's slug")
    reason: str = Field(
        ...,
        min_length=3,
        max_length=2000,
        description="Why it comes down, kept for whoever restores it",
    )


class TakedownResponse(BaseModel):
    """One takedown, standing or lifted."""

    id: str = Field(..., description="Takedown ID")
    entry_id: str = Field(..., description="The profile taken down")
    entry_name: str = Field(..., description="The profile's name when it came down")
    entry_slug: str | None = Field(None, description="The profile's slug when it came down")
    entry_type: str = Field(..., description="person or organization")
    reason: str = Field(..., description="Why it came down")
    was_active: bool = Field(..., description="Whether it was published when it came down")
    taken_down_by: str = Field(..., description="The editor who took it down")
    taken_down_at: str = Field(..., description="When it came down")
    restored_by: str | None = Field(None, description="The editor who restored it")
    restored_at: str | None = Field(None, description="When it was restored")


class TakedownCollectionResponse(BaseModel):
    """The takedowns that stand."""

    items: list[TakedownResponse] = Field(..., description="Standing takedowns, newest first")


def _response(takedown: EntryTakedown) -> TakedownResponse:
    return TakedownResponse.model_validate(takedown, from_attributes=True)


def _editor(actor: AuthenticatedActor) -> str:
    """Return who acted, as the operator list and the audit log spell it."""
    email = actor.email.strip().lower()
    return email or actor.user_id


@router.get(
    "/takedowns",
    response_model=TakedownCollectionResponse,
    summary="List standing takedowns",
    description="Profiles an editor took down and has not restored, newest first.",
    operation_id="listTakedowns",
    tags=["moderation"],
)
async def list_takedowns(
    response: Response,
    limit: int = Query(200, ge=1, le=500),
    actor: AuthenticatedActor = Depends(require_action(Action.ENTRIES_TAKEDOWN)),
    db: aiosqlite.Connection = Depends(get_db),
) -> TakedownCollectionResponse:
    """List the takedowns that stand."""
    _ = actor
    takedowns = await EntryTakedownCRUD.list_standing(db, limit=limit)
    apply_no_store_headers(response)
    return TakedownCollectionResponse(items=[_response(item) for item in takedowns])


@router.post(
    "/takedowns",
    response_model=TakedownResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Take a profile down",
    description=(
        "Hide a profile, published or waiting for review, and keep it hidden: no approval, "
        "registry match or later discovery run republishes it until it is restored."
    ),
    operation_id="createTakedown",
    tags=["moderation"],
)
async def create_takedown(
    request: TakedownCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_action(Action.ENTRIES_TAKEDOWN)),
    db: aiosqlite.Connection = Depends(get_db),
) -> TakedownResponse:
    """Take a profile down and record why."""
    apply_no_store_headers(response)
    target = await EntryTakedownCRUD.find_target(db, request.slug.strip())
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PROFILE_NOT_FOUND_DETAIL)
    try:
        takedown = await EntryTakedownCRUD.take_down(
            db, target, reason=request.reason.strip(), taken_down_by=_editor(actor)
        )
    except TakedownConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _response(takedown)


@router.post(
    "/takedowns/{takedown_id}/restore",
    response_model=TakedownResponse,
    summary="Restore a profile",
    description=(
        "Lift a takedown. A profile that was published before it came down is published "
        "again; one that was waiting for review goes back to waiting."
    ),
    operation_id="restoreTakedown",
    tags=["moderation"],
)
async def restore_takedown(
    takedown_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_action(Action.ENTRIES_TAKEDOWN)),
    db: aiosqlite.Connection = Depends(get_db),
) -> TakedownResponse:
    """Lift a takedown."""
    apply_no_store_headers(response)
    try:
        restored = await EntryTakedownCRUD.restore(db, takedown_id, restored_by=_editor(actor))
    except TakedownConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if restored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=TAKEDOWN_NOT_FOUND_DETAIL)
    return _response(restored)
