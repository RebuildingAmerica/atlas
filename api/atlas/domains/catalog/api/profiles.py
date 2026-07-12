"""Slug-based profile actions: verify, manage, follow."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.catalog.api.profile_claim_helpers import get_db
from atlas.domains.catalog.api.profile_claim_review import router as claim_review_router
from atlas.domains.catalog.api.profile_claims import router as claim_router
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.profile_atproto_links import (
    ProfileAtprotoLinkConflictError,
    ProfileAtprotoLinkCRUD,
)
from atlas.domains.catalog.schemas.public import (
    ProfileAtprotoIdentityAttachRequest,
    ProfileAtprotoIdentityLinkResponse,
    ProfileFollowResponse,
    ProfileManageRequest,
)
from atlas.domains.catalog.services.atproto_identity import resolve_current_atproto_identity
from atlas.models import EntryCRUD
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter()
router.include_router(claim_review_router)
router.include_router(claim_router)

__all__ = ["router"]


@router.patch(
    "/{slug}/manage",
    summary="Update verified profile fields",
    description=(
        "Update fields on a verified profile: custom bio, photo URL, suppressed sources, "
        "and preferred contact. Requires verified representative access."
    ),
    operation_id="manageProfile",
    tags=["claims"],
)
async def manage_profile(
    slug: str,
    payload: ProfileManageRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Update editable fields on a verified profile."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    if entry.claim_status != "verified" or entry.claimed_by_user_id != actor.user_id:
        raise HTTPException(
            status_code=403,
            detail="Only a verified representative can manage this profile.",
        )

    update_fields: dict[str, Any] = {}
    if payload.clear_photo:
        update_fields["photo_url"] = None
    elif payload.photo_url is not None:
        update_fields["photo_url"] = payload.photo_url
    if payload.clear_custom_bio:
        update_fields["custom_bio"] = None
    elif payload.custom_bio is not None:
        update_fields["custom_bio"] = payload.custom_bio
    if payload.suppressed_source_ids is not None:
        update_fields["suppressed_source_ids"] = list(dict.fromkeys(payload.suppressed_source_ids))
    if payload.preferred_contact_channel is not None:
        update_fields["preferred_contact_channel"] = payload.preferred_contact_channel

    if not update_fields:
        apply_no_store_headers(response)
        return {"updated": False, "fields": []}

    update_fields["last_confirmed_at"] = datetime.now(UTC).isoformat()
    await EntryCRUD.update(db, entry.id, **update_fields)
    apply_no_store_headers(response)
    return {"updated": True, "fields": sorted(update_fields.keys())}


@router.put(
    "/{slug}/atproto-identity",
    response_model=ProfileAtprotoIdentityLinkResponse,
    operation_id="attachProfileAtprotoIdentity",
    summary="Attach a verified public ATProto identity",
    description=(
        "Let a verified profile steward attach a currently controlled and freshly resolved ATProto "
        "identity. Replacing another public identity requires explicit confirmation and writes a "
        "new auditable relation without changing account control or workspace membership."
    ),
    tags=["identity"],
)
async def attach_profile_atproto_identity(
    slug: str,
    payload: ProfileAtprotoIdentityAttachRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileAtprotoIdentityLinkResponse:
    """Attach a currently controlled identity for a verified profile steward."""
    entry = await _verified_steward_entry(db, slug, actor.user_id)
    control = await AtprotoIdentityControlCRUD.get_active_for_user_and_identity(
        db,
        user_id=actor.user_id,
        identity_id=payload.atproto_identity_id,
    )
    identity = await AtprotoIdentityCRUD.get_by_id(db, payload.atproto_identity_id)
    if control is None or identity is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reconnect this ATProto account before using it for this profile.",
        )
    resolution = await resolve_current_atproto_identity(identity.did)
    if resolution is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reconnect this ATProto account before using it for this profile.",
        )
    identity = await AtprotoIdentityCRUD.upsert(
        db,
        did=resolution.did,
        handle=resolution.handle,
        pds_url=resolution.pds_url,
    )
    try:
        link = await ProfileAtprotoLinkCRUD.attach(
            db,
            entry_id=entry.id,
            identity_id=identity.id,
            replace=payload.replace,
        )
    except ProfileAtprotoLinkConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This profile already has an ATProto identity. Confirm replacement to continue.",
        ) from error
    await db.commit()
    apply_no_store_headers(response)
    return ProfileAtprotoIdentityLinkResponse(
        identity_id=identity.id,
        did=identity.did,
        current_handle=identity.current_handle,
        status=link.status,
        verified_at=link.verified_at,
    )


@router.delete(
    "/{slug}/atproto-identity",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="detachProfileAtprotoIdentity",
    summary="Remove a public ATProto identity",
    description=(
        "Let a verified profile steward remove the current public ATProto relation while retaining "
        "its audit history. The global DID and every account-control relationship remain intact, "
        "so this profile action cannot disconnect or transfer the external account."
    ),
    tags=["identity"],
)
async def detach_profile_atproto_identity(
    slug: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Remove a profile relation without deleting identity or account control."""
    entry = await _verified_steward_entry(db, slug, actor.user_id)
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(db, entry.id)
    if link is None:
        raise HTTPException(status_code=404, detail="Public ATProto identity not found.")
    await ProfileAtprotoLinkCRUD.remove(db, link.id)
    await db.commit()
    apply_no_store_headers(response)
    response.status_code = status.HTTP_204_NO_CONTENT


async def _verified_steward_entry(db: aiosqlite.Connection, slug: str, user_id: str) -> Any:
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    if entry.claim_status != "verified" or entry.claimed_by_user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only a verified representative can manage this profile.",
        )
    return entry


@router.post(
    "/{slug}/follow",
    response_model=ProfileFollowResponse,
    summary="Follow a profile",
    description="Subscribe the authenticated user to updates on a profile.",
    operation_id="followProfile",
    status_code=status.HTTP_201_CREATED,
    tags=["follows"],
)
async def follow_profile(
    slug: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileFollowResponse:
    """Follow a profile."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    follow = await FollowCRUD.follow(db, user_id=actor.user_id, entry_id=entry.id)
    apply_no_store_headers(response)
    return ProfileFollowResponse(
        user_id=follow.user_id,
        entry_id=follow.entry_id,
        subscribed_to=follow.subscribed_to,
        created_at=follow.created_at,
    )


@router.delete(
    "/{slug}/follow",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unfollow a profile",
    description="Drop the authenticated user's subscription to a profile.",
    operation_id="unfollowProfile",
    tags=["follows"],
)
async def unfollow_profile(
    slug: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> Response:
    """Drop the authenticated user's subscription to a profile."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    await FollowCRUD.unfollow(db, user_id=actor.user_id, entry_id=entry.id)
    apply_no_store_headers(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get(
    "/{slug}/follow",
    response_model=ProfileFollowResponse | None,
    summary="Get follow status",
    description="Return the current user's follow record for a profile (or null).",
    operation_id="getProfileFollow",
    tags=["follows"],
)
async def get_follow(
    slug: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileFollowResponse | None:
    """Return the current user's follow record for a profile, if any."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    follow = await FollowCRUD.is_following(db, user_id=actor.user_id, entry_id=entry.id)
    apply_no_store_headers(response)
    if follow is None:
        return None
    return ProfileFollowResponse(
        user_id=follow.user_id,
        entry_id=follow.entry_id,
        subscribed_to=follow.subscribed_to,
        created_at=follow.created_at,
    )
