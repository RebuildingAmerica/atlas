"""Profile verification and claim routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.catalog.api.profile_claim_atproto_helpers import link_atproto_proof_if_present
from atlas.domains.catalog.api.profile_claim_helpers import (
    DnsProfileClaimTxtResolver,
    claim_evidence_payload,
    claim_to_response,
    get_db,
    get_profile_claim_policy,
    verify_claim_with_entry,
)
from atlas.domains.catalog.api.profile_claim_structured import (
    apply_structured_proofs,
    validate_atproto_organization_backing,
    validate_dns_domain_backing,
    validate_workspace_backing,
)
from atlas.domains.catalog.models.profile_claims import VERIFICATION_TOKEN_TTL, ProfileClaimCRUD
from atlas.domains.catalog.schemas.public import (
    ProfileClaimProofRequest,
    ProfileClaimRequest,
    ProfileClaimResponse,
    ProfileClaimVerifyRequest,
)
from atlas.domains.catalog.services.profile_claims import (
    CLAIM_TIER_EMAIL_DOMAIN,
    ProfileClaimPolicy,
)
from atlas.models import EntryCRUD
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter()


@router.post(
    "/{slug}/claim",
    response_model=ProfileClaimResponse,
    summary="Start profile verification",
    description="Starts profile verification for the authenticated user.",
    operation_id="initiateProfileClaim",
    status_code=status.HTTP_201_CREATED,
    tags=["claims"],
)
async def initiate_claim(  # noqa: PLR0913
    slug: str,
    payload: ProfileClaimRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
    claim_policy: ProfileClaimPolicy = Depends(get_profile_claim_policy),
    settings: Settings = Depends(get_settings),
) -> ProfileClaimResponse:
    """Start profile verification for the profile identified by ``slug``."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    if entry.claim_status == "verified":
        existing = await ProfileClaimCRUD.get_active_for_entry(db, entry.id)
        if existing is not None and existing.user_id == actor.user_id:
            apply_no_store_headers(response)
            return await claim_to_response(db, existing, entry)
        raise HTTPException(
            status_code=409,
            detail="This profile is already verified by another user.",
        )
    if entry.claim_status == "pending":
        existing = await ProfileClaimCRUD.get_active_for_entry(db, entry.id)
        if existing is not None and existing.status == "pending":
            if existing.user_id == actor.user_id:
                apply_no_store_headers(response)
                return await claim_to_response(db, existing, entry)
            raise HTTPException(
                status_code=409,
                detail="This profile already has a verification waiting for review.",
            )

    claim_decision = claim_policy.classify(entry, actor.email)
    has_structured_proof = (
        payload.atproto_identity_id is not None
        or payload.dns_domain is not None
        or payload.use_active_workspace
    )
    if (
        claim_decision.requires_manual_evidence
        and not has_structured_proof
        and not (payload.evidence and payload.evidence.strip())
    ):
        raise HTTPException(
            status_code=400,
            detail="Evidence is required for manual-review claims.",
        )

    if payload.atproto_identity_id is not None:
        await validate_atproto_organization_backing(
            db,
            entry=entry,
            actor=actor,
            identity_id=payload.atproto_identity_id,
            claim_policy=claim_policy,
            has_organization_backing=payload.dns_domain is not None or payload.use_active_workspace,
        )
    if payload.dns_domain is not None:
        validate_dns_domain_backing(entry, payload.dns_domain)
    workspace_membership = None
    if payload.use_active_workspace:
        workspace_membership = await validate_workspace_backing(actor, settings)

    claim = await ProfileClaimCRUD.create(
        db,
        entry_id=entry.id,
        user_id=actor.user_id,
        user_email=actor.email,
        tier=claim_decision.tier,
        evidence=claim_evidence_payload(payload),
        token_ttl=VERIFICATION_TOKEN_TTL,
    )

    claim = await apply_structured_proofs(
        db,
        claim=claim,
        entry=entry,
        payload=payload,
        actor=actor,
        claim_policy=claim_policy,
        settings=settings,
        workspace_membership=workspace_membership,
    )

    refreshed_entry = await EntryCRUD.get_by_id(db, entry.id)
    if refreshed_entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    apply_no_store_headers(response)
    return await claim_to_response(db, claim, refreshed_entry)


@router.post(
    "/claims/verify-email",
    response_model=ProfileClaimResponse,
    summary="Verify by email",
    description=("Exchanges an email verification token for verified representative access."),
    operation_id="verifyProfileClaim",
    tags=["claims"],
)
async def verify_claim(
    payload: ProfileClaimVerifyRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
    claim_policy: ProfileClaimPolicy = Depends(get_profile_claim_policy),
) -> ProfileClaimResponse:
    """Verify representative access using an emailed token."""
    claim = await ProfileClaimCRUD.get_by_token(db, payload.token)
    if claim is None:
        raise HTTPException(status_code=404, detail="Verification token not found.")
    if claim.status != "pending":
        raise HTTPException(status_code=409, detail=f"Claim is {claim.status}.")

    entry = await EntryCRUD.get_by_id(db, claim.entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    proof = claim_policy.email_domain_proof(entry, claim.user_email)
    if claim.tier != CLAIM_TIER_EMAIL_DOMAIN or proof is None:
        raise HTTPException(
            status_code=409,
            detail="Email verification is only available for low-risk organization claims.",
        )

    expires = (
        datetime.fromisoformat(claim.verification_token_expires_at)
        if claim.verification_token_expires_at
        else None
    )
    if expires is None or expires < datetime.now(UTC):
        await ProfileClaimCRUD.mark_rejected(db, claim.id, reason="Verification token expired.")
        raise HTTPException(status_code=410, detail="Verification token expired.")

    verified = await ProfileClaimCRUD.mark_verified(
        db,
        claim.id,
        proof_type=proof.proof_type,
        proof_summary=proof.summary,
        proof_metadata=proof.metadata,
    )
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

    apply_no_store_headers(response)
    refreshed_entry = await EntryCRUD.get_by_id(db, entry.id)
    if refreshed_entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return await claim_to_response(db, verified, refreshed_entry)


@router.post(
    "/{slug}/claims/{claim_id}/verify-domain",
    response_model=ProfileClaimResponse,
    summary="Verify an organization domain",
    description="Checks the DNS record for an organization profile verification.",
    operation_id="verifyProfileClaimDomain",
    tags=["claims"],
)
async def verify_claim_domain(
    slug: str,
    claim_id: str,
    _payload: ProfileClaimProofRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> ProfileClaimResponse:
    """Verify a pending DNS TXT record for an organization profile."""
    entry = await EntryCRUD.get_by_slug(db, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    claim = await ProfileClaimCRUD.get_by_id(db, claim_id)
    if claim is None or claim.entry_id != entry.id:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.user_id != actor.user_id:
        raise HTTPException(status_code=403, detail="Claim belongs to another user.")
    if claim.status != "pending":
        raise HTTPException(status_code=409, detail=f"Claim is {claim.status}.")

    proofs = await ProfileClaimCRUD.list_proofs(db, claim.id)
    dns_proof = next(
        (
            proof
            for proof in proofs
            if proof.proof_type == "domain_dns" and proof.proof_status == "pending"
        ),
        None,
    )
    if dns_proof is None or not isinstance(dns_proof.metadata, dict):
        raise HTTPException(status_code=404, detail="DNS record request not found.")

    challenge_value = dns_proof.metadata.get("challenge_value")
    challenge_host = dns_proof.metadata.get("challenge_host")
    if not isinstance(challenge_value, str) or not isinstance(challenge_host, str):
        raise HTTPException(status_code=409, detail="DNS TXT record is incomplete.")
    txt_records = await DnsProfileClaimTxtResolver().resolve_txt_records(challenge_host)
    if challenge_value not in txt_records:
        raise HTTPException(status_code=409, detail="DNS TXT record not found.")

    await ProfileClaimCRUD.mark_proof_verified(
        db,
        dns_proof.id,
        proof_metadata=dns_proof.metadata,
    )
    verified = await verify_claim_with_entry(
        db,
        claim.id,
        proof_type="domain_dns",
        proof_summary=dns_proof.proof_summary.replace("Waiting for", "Verified"),
        proof_metadata=dns_proof.metadata,
    )
    await link_atproto_proof_if_present(db, claim.id, entry.id, verified_at=verified.verified_at)
    refreshed_entry = await EntryCRUD.get_by_id(db, entry.id)
    if refreshed_entry is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    apply_no_store_headers(response)
    return await claim_to_response(db, verified, refreshed_entry)


@router.get(
    "/claims/me",
    response_model=list[ProfileClaimResponse],
    summary="List my profile verifications",
    description="Returns all profile verifications belonging to the authenticated user.",
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
        if entry is not None:
            out.append(await claim_to_response(db, claim, entry))
    return out
