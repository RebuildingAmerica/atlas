"""Reviewer decisions for pending profile verifications."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from atlas.domains.access import require_actor_permission
from atlas.domains.catalog.api.profile_claim_atproto_helpers import link_atproto_proof_if_present
from atlas.domains.catalog.api.profile_claim_helpers import (
    claim_to_response,
    get_db,
    verify_claim_with_entry,
)
from atlas.domains.catalog.models.profile_claim_review import (
    count_pending_profile_claim_reviews,
    list_pending_profile_claim_reviews,
)
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.schemas.public import (
    ProfileAtprotoRevalidationResponse,
    ProfileClaimResponse,
    ProfileClaimReviewDecisionRequest,
    ProfileClaimReviewListResponse,
)
from atlas.domains.catalog.services.atproto_identity import revalidate_linked_atproto_profiles
from atlas.models import EntryCRUD
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor
    from atlas.domains.catalog.models.profile_claims import ProfileClaimModel

router = APIRouter()


@router.get(
    "/claims/review",
    response_model=ProfileClaimReviewListResponse,
    summary="List profile verifications for review",
    description="List pending profile representative verifications for reviewer action.",
    operation_id="listProfileClaimReviews",
    tags=["claims"],
)
async def list_profile_claim_reviews(
    response: Response,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileClaimReviewListResponse:
    """List pending profile verifications oldest-first."""
    _ = actor
    items: list[ProfileClaimResponse] = []
    for claim in await list_pending_profile_claim_reviews(db, limit=limit, offset=offset):
        entry = await EntryCRUD.get_by_id(db, claim.entry_id)
        if entry is not None:
            items.append(await claim_to_response(db, claim, entry))
    total = await count_pending_profile_claim_reviews(db)
    apply_no_store_headers(response)
    return ProfileClaimReviewListResponse(items=items, total=total)


@router.post(
    "/claims/review/atproto/revalidate",
    response_model=ProfileAtprotoRevalidationResponse,
    summary="Recheck linked ATProto profiles",
    description="Flag linked ATProto profiles whose current handle and DID no longer match.",
    operation_id="revalidateProfileAtprotoLinks",
    tags=["claims"],
)
async def revalidate_profile_atproto_links(
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileAtprotoRevalidationResponse:
    """Recheck public ATProto profile links without deleting identity provenance."""
    _ = actor
    result = await revalidate_linked_atproto_profiles(db)
    apply_no_store_headers(response)
    return ProfileAtprotoRevalidationResponse(
        checked=result.checked, needs_attention=result.needs_attention
    )


@router.post(
    "/claims/review/{claim_id}/approve",
    response_model=ProfileClaimResponse,
    summary="Approve a profile verification",
    description="Verify a pending profile representative after reviewer confirmation.",
    operation_id="approveProfileClaimReview",
    tags=["claims"],
)
async def approve_profile_claim_review(
    claim_id: str,
    payload: ProfileClaimReviewDecisionRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileClaimResponse:
    """Approve a pending profile verification."""
    claim, entry = await _pending_claim_and_entry(db, claim_id)
    verified = await verify_claim_with_entry(
        db,
        claim.id,
        proof_type="manual_review",
        proof_summary="Reviewer confirmed this representative.",
        proof_metadata=_review_metadata(actor, payload),
    )
    await link_atproto_proof_if_present(db, claim.id, entry.id, verified_at=verified.verified_at)
    refreshed_entry = await EntryCRUD.get_by_id(db, entry.id)
    if refreshed_entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    apply_no_store_headers(response)
    return await claim_to_response(db, verified, refreshed_entry)


@router.post(
    "/claims/review/{claim_id}/reject",
    response_model=ProfileClaimResponse,
    summary="Reject a profile verification",
    description="Reject a pending profile representative when the evidence does not match.",
    operation_id="rejectProfileClaimReview",
    tags=["claims"],
)
async def reject_profile_claim_review(
    claim_id: str,
    payload: ProfileClaimReviewDecisionRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileClaimResponse:
    """Reject a pending profile verification."""
    claim, entry = await _pending_claim_and_entry(db, claim_id)
    reason = _review_note(payload) or "Reviewer could not confirm this representative."
    rejected = await ProfileClaimCRUD.mark_rejected(db, claim.id, reason=reason)
    if rejected is None:
        raise HTTPException(status_code=500, detail="Failed to reject claim.")
    await ProfileClaimCRUD.record_proof(
        db,
        claim_id=claim.id,
        proof_type="manual_review",
        proof_status="rejected",
        proof_summary=reason,
        proof_metadata=_review_metadata(actor, payload),
    )
    await _restore_entry_after_rejection(db, entry.id)
    refreshed_entry = await EntryCRUD.get_by_id(db, entry.id)
    if refreshed_entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    apply_no_store_headers(response)
    return await claim_to_response(db, rejected, refreshed_entry)


async def _pending_claim_and_entry(
    db: aiosqlite.Connection,
    claim_id: str,
) -> tuple[ProfileClaimModel, Any]:
    claim = await ProfileClaimCRUD.get_by_id(db, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Claim is {claim.status}."
        )
    entry = await EntryCRUD.get_by_id(db, claim.entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return claim, entry


def _review_metadata(
    actor: AuthenticatedActor,
    payload: ProfileClaimReviewDecisionRequest,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        "reviewer_email": actor.email,
        "reviewer_id": actor.user_id,
    }
    note = _review_note(payload)
    if note is not None:
        metadata["note"] = note
    return metadata


def _review_note(payload: ProfileClaimReviewDecisionRequest) -> str | None:
    if payload.note is None:
        return None
    note = payload.note.strip()
    return note or None


async def _restore_entry_after_rejection(db: aiosqlite.Connection, entry_id: str) -> None:
    active = await ProfileClaimCRUD.get_active_for_entry(db, entry_id)
    if active is not None and active.status == "pending":
        await EntryCRUD.update(
            db,
            entry_id,
            claim_status="pending",
            claimed_by_user_id=active.user_id,
            claim_verified_at=None,
        )
        return
    await EntryCRUD.update(
        db,
        entry_id,
        claim_status="unclaimed",
        claimed_by_user_id=None,
        claim_verified_at=None,
    )
