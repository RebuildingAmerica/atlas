"""Slug-based profile actions: claim, verify, manage, follow."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.catalog.models.profile_claims import (
    VERIFICATION_TOKEN_TTL,
    ProfileClaimCRUD,
)
from atlas.domains.catalog.schemas.public import (
    ProfileClaimRequest,
    ProfileClaimResponse,
    ProfileClaimVerifyRequest,
    ProfileFollowResponse,
    ProfileManageRequest,
)
from atlas.models import EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]

CLAIM_TIER_TWO = 2


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


_WWW_PREFIX = "www."


def _domain_of(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if "@" in cleaned:
        cleaned = cleaned.rsplit("@", 1)[1]
    parsed = urlparse(cleaned if "://" in cleaned else f"https://{cleaned}")
    host = (parsed.hostname or cleaned).lower()
    if host.startswith(_WWW_PREFIX):
        host = host[len(_WWW_PREFIX) :]
    return host


def _entry_email_domains(entry: Any) -> set[str]:
    """Return the set of domains derivable from the entry's email/website."""
    domains: set[str] = set()
    email_domain = _domain_of(entry.email)
    if email_domain:
        domains.add(email_domain)
    website_domain = _domain_of(entry.website)
    if website_domain:
        domains.add(website_domain)
    return domains


def _claim_to_response(claim: Any, entry: Any) -> ProfileClaimResponse:
    return ProfileClaimResponse(
        id=claim.id,
        entry_id=claim.entry_id,
        entry_slug=entry.slug,
        entry_name=entry.name,
        user_id=claim.user_id,
        user_email=claim.user_email,
        status=claim.status,
        tier=claim.tier,
        evidence=(json.loads(claim.evidence_json) if claim.evidence_json else None),
        verified_at=claim.verified_at,
        rejected_reason=claim.rejected_reason,
        created_at=claim.created_at,
        updated_at=claim.updated_at,
    )


@router.post(
    "/{slug}/claim",
    response_model=ProfileClaimResponse,
    summary="Initiate a profile claim",
    description=(
        "Creates a pending profile claim for the authenticated user. "
        "If the user's email domain matches the profile's email or website "
        "domain, the claim is tier 1 (email verification); otherwise it is "
        "tier 2 (manual review)."
    ),
    operation_id="initiateProfileClaim",
    status_code=status.HTTP_201_CREATED,
    tags=["claims"],
)
async def initiate_claim(
    slug: str,
    payload: ProfileClaimRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileClaimResponse:
    """Initiate a claim for the profile identified by ``slug``."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    if entry.claim_status == "verified":
        existing = await ProfileClaimCRUD.get_active_for_entry(db, entry.id)
        if existing is not None and existing.user_id == actor.user_id:
            apply_no_store_headers(response)
            return _claim_to_response(existing, entry)
        raise HTTPException(
            status_code=409,
            detail="This profile is already verified by another user.",
        )

    actor_domain = _domain_of(actor.email)
    matched_domains = _entry_email_domains(entry)
    is_tier_one = bool(actor_domain and actor_domain in matched_domains)
    tier = 1 if is_tier_one else 2

    if tier == CLAIM_TIER_TWO and not (payload.evidence and payload.evidence.strip()):
        raise HTTPException(
            status_code=400,
            detail="Evidence is required for manual-review claims.",
        )

    claim = await ProfileClaimCRUD.create(
        db,
        entry_id=entry.id,
        user_id=actor.user_id,
        user_email=actor.email,
        tier=tier,
        evidence=payload.evidence,
        token_ttl=VERIFICATION_TOKEN_TTL,
    )

    await EntryCRUD.update(
        db,
        entry.id,
        claim_status="pending",
        claimed_by_user_id=actor.user_id,
    )

    apply_no_store_headers(response)
    return _claim_to_response(claim, entry)


@router.post(
    "/claims/verify-email",
    response_model=ProfileClaimResponse,
    summary="Verify a tier-1 claim",
    description=(
        "Completes a tier-1 claim by exchanging a verification token (delivered "
        "to the subject's email) for a verified claim record."
    ),
    operation_id="verifyProfileClaim",
    tags=["claims"],
)
async def verify_claim(
    payload: ProfileClaimVerifyRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileClaimResponse:
    """Verify a tier-1 claim using its emailed token."""
    claim = await ProfileClaimCRUD.get_by_token(db, payload.token)
    if claim is None:
        raise HTTPException(status_code=404, detail="Verification token not found.")

    if claim.status != "pending":
        raise HTTPException(status_code=409, detail=f"Claim is {claim.status}.")

    expires = (
        datetime.fromisoformat(claim.verification_token_expires_at)
        if claim.verification_token_expires_at
        else None
    )
    if expires is None or expires < datetime.now(UTC):
        await ProfileClaimCRUD.mark_rejected(db, claim.id, reason="Verification token expired.")
        raise HTTPException(status_code=410, detail="Verification token expired.")

    verified = await ProfileClaimCRUD.mark_verified(db, claim.id)
    if verified is None:
        raise HTTPException(status_code=500, detail="Failed to verify claim.")

    await EntryCRUD.update(
        db,
        verified.entry_id,
        claim_status="verified",
        claimed_by_user_id=verified.user_id,
        claim_verified_at=verified.verified_at,
        last_confirmed_at=verified.verified_at,
    )

    entry = await EntryCRUD.get_by_id(db, verified.entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    apply_no_store_headers(response)
    return _claim_to_response(verified, entry)


@router.get(
    "/claims/me",
    response_model=list[ProfileClaimResponse],
    summary="List my claims",
    description="Returns all profile claims belonging to the authenticated user.",
    operation_id="listMyProfileClaims",
    tags=["claims"],
)
async def list_my_claims(
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[ProfileClaimResponse]:
    """List claims belonging to the current actor."""
    claims = await ProfileClaimCRUD.list_by_user(db, actor.user_id)
    apply_no_store_headers(response)
    out: list[ProfileClaimResponse] = []
    for claim in claims:
        entry = await EntryCRUD.get_by_id(db, claim.entry_id)
        if entry is None:
            continue
        out.append(_claim_to_response(claim, entry))
    return out


@router.patch(
    "/{slug}/manage",
    summary="Manage subject-controlled fields",
    description=(
        "Update subject-managed fields on a profile (custom bio, photo URL, "
        "suppressed sources, preferred contact). Requires a verified claim."
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
    """Update subject-controlled fields on a verified profile."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    if entry.claim_status != "verified" or entry.claimed_by_user_id != actor.user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the verified subject of a claim can manage this profile.",
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
