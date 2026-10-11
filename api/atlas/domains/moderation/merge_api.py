"""Editorial routes for merging a duplicate profile into the one to keep."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from atlas.domains.access import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)
from atlas.domains.moderation.api import get_db
from atlas.domains.moderation.merges import EntryMerge, EntryMergeCRUD, MergeBlockedError
from atlas.domains.moderation.takedowns import EntryTakedownCRUD, TakedownTarget
from atlas.platform.authz import Action, require_action
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter()


class MergeProfileResponse(BaseModel):
    """One of the two profiles in a merge."""

    id: str = Field(..., description="Entry ID")
    name: str = Field(..., description="The profile's name")
    slug: str = Field(..., description="The profile's slug")
    type: str = Field(..., description="person, organization, or another entry type")
    active: bool = Field(..., description="Whether it is published")


class MergeCountsResponse(BaseModel):
    """What moves, or moved, from the duplicate to the kept profile."""

    sources: int = Field(..., ge=0, description="Source links the kept profile gains")
    issue_areas: int = Field(..., ge=0, description="Issue areas the kept profile gains")
    connections: int = Field(..., ge=0, description="Connections to other profiles that move")
    followers: int = Field(..., ge=0, description="People who now follow the kept profile")
    saved_list_places: int = Field(..., ge=0, description="Saved lists that now hold it")
    open_reports: int = Field(..., ge=0, description="Open visitor reports that move")
    identity_keys: int = Field(..., ge=0, description="EIN, FEC or domain keys that move")
    pending_reviews: int = Field(
        ..., ge=0, description="Pending discovery reviews on the duplicate that close"
    )


class MergePreviewResponse(BaseModel):
    """What a merge would do, and anything that stops it."""

    keep: MergeProfileResponse
    duplicate: MergeProfileResponse
    moves: MergeCountsResponse
    blockers: list[str] = Field(..., description="Every reason the merge is refused; empty if none")


class MergeCreateRequest(BaseModel):
    """Which profile to keep, which to fold into it, and why."""

    keep: str = Field(..., min_length=1, max_length=200, description="Slug of the profile to keep")
    duplicate: str = Field(
        ..., min_length=1, max_length=200, description="Slug of the duplicate to retire"
    )
    reason: str = Field(
        ..., min_length=3, max_length=2000, description="How the editor knows they are the same"
    )


class EntryMergeResponse(BaseModel):
    """One merge that was made."""

    id: str = Field(..., description="Merge ID")
    kept_entry_id: str
    kept_name: str
    kept_slug: str | None
    duplicate_entry_id: str
    duplicate_name: str
    duplicate_slug: str | None
    reason: str
    merged_by: str = Field(..., description="The editor who merged them")
    merged_at: str
    moved: MergeCountsResponse


class EntryMergeCollectionResponse(BaseModel):
    """Past merges."""

    items: list[EntryMergeResponse] = Field(..., description="Merges, newest first")


def _profile(profile: TakedownTarget) -> MergeProfileResponse:
    assert profile.slug is not None, "a merge profile is found by its slug"
    return MergeProfileResponse(
        id=profile.id,
        name=profile.name,
        slug=profile.slug,
        type=profile.type,
        active=profile.active,
    )


def _merge(merge: EntryMerge) -> EntryMergeResponse:
    return EntryMergeResponse.model_validate(merge, from_attributes=True)


def _editor(actor: AuthenticatedActor) -> str:
    """Return who acted, as the operator list and the audit log spell it."""
    email = actor.email.strip().lower()
    return email or actor.user_id


async def _pair(
    db: aiosqlite.Connection, keep_slug: str, duplicate_slug: str
) -> tuple[TakedownTarget, TakedownTarget]:
    keep = await EntryTakedownCRUD.find_target(db, keep_slug.strip())
    if keep is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No profile has the address {keep_slug.strip()}.",
        )
    duplicate = await EntryTakedownCRUD.find_target(db, duplicate_slug.strip())
    if duplicate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No profile has the address {duplicate_slug.strip()}.",
        )
    return keep, duplicate


@router.get(
    "/merges",
    response_model=EntryMergeCollectionResponse,
    summary="List profile merges",
    description="Duplicate profiles editors folded into the profile to keep, newest first.",
    operation_id="listEntryMerges",
    tags=["moderation"],
)
async def list_merges(
    response: Response,
    limit: int = Query(100, ge=1, le=500),
    actor: AuthenticatedActor = Depends(require_action(Action.ENTRIES_MERGE)),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntryMergeCollectionResponse:
    """List past merges."""
    _ = actor
    apply_no_store_headers(response)
    merges = await EntryMergeCRUD.list_recent(db, limit=limit)
    return EntryMergeCollectionResponse(items=[_merge(merge) for merge in merges])


@router.get(
    "/merges/preview",
    response_model=MergePreviewResponse,
    summary="Check a profile merge",
    description=(
        "Show what merging one profile into another would move, and anything that stops it. "
        "Changes nothing."
    ),
    operation_id="previewEntryMerge",
    tags=["moderation"],
)
async def preview_merge(
    response: Response,
    keep: str = Query(..., min_length=1, max_length=200, description="Slug to keep"),
    duplicate: str = Query(..., min_length=1, max_length=200, description="Slug to retire"),
    actor: AuthenticatedActor = Depends(require_action(Action.ENTRIES_MERGE)),
    db: aiosqlite.Connection = Depends(get_db),
) -> MergePreviewResponse:
    """Plan a merge without making it."""
    _ = actor
    apply_no_store_headers(response)
    kept, retired = await _pair(db, keep, duplicate)
    plan = await EntryMergeCRUD.plan(db, kept, retired)
    return MergePreviewResponse(
        keep=_profile(plan.keep),
        duplicate=_profile(plan.duplicate),
        moves=MergeCountsResponse.model_validate(plan.moves, from_attributes=True),
        blockers=list(plan.blockers),
    )


@router.post(
    "/merges",
    response_model=EntryMergeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Merge a duplicate profile",
    description=(
        "Fold a duplicate into the profile to keep: sources, issue areas, connections, "
        "followers, saved-list places, open reports and identity keys move over, the "
        "duplicate is retired, and its address opens the kept profile. Cannot be undone."
    ),
    operation_id="createEntryMerge",
    tags=["moderation"],
)
async def create_merge(
    request: MergeCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_action(Action.ENTRIES_MERGE)),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntryMergeResponse:
    """Merge two profiles and record why."""
    apply_no_store_headers(response)
    keep, duplicate = await _pair(db, request.keep, request.duplicate)
    try:
        merge = await EntryMergeCRUD.merge(
            db, keep, duplicate, reason=request.reason.strip(), merged_by=_editor(actor)
        )
    except MergeBlockedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _merge(merge)
