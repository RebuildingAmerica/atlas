"""Shared helpers for profile verification routes."""

from __future__ import annotations

import json
import secrets
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Any

from fastapi import Depends, HTTPException

from atlas.domains.access.membership import MembershipResult, verify_org_membership
from atlas.domains.catalog.models.profile_claims import (
    ProfileClaimCRUD,
    ProfileClaimModel,
    ProfileClaimProofModel,
)
from atlas.domains.catalog.schemas.public import (
    ProfileClaimProofResponse,
    ProfileClaimRequest,
    ProfileClaimResponse,
)
from atlas.domains.catalog.services.directory_domains import DnsDirectoryDomainTxtResolver
from atlas.domains.catalog.services.profile_claims import ProfileClaimPolicy, entry_claim_domains
from atlas.models import EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor


class DnsProfileClaimTxtResolver(DnsDirectoryDomainTxtResolver):
    """DNS TXT resolver for profile-claim domain challenges."""


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def get_profile_claim_policy() -> ProfileClaimPolicy:
    """Build the profile-claim policy service for request handlers."""
    return ProfileClaimPolicy()


def proof_to_response(proof: ProfileClaimProofModel) -> ProfileClaimProofResponse:
    """Convert a claim proof record into its public API schema."""
    return ProfileClaimProofResponse(
        id=proof.id,
        proof_type=proof.proof_type,
        proof_status=proof.proof_status,
        proof_summary=proof.proof_summary,
        metadata=proof.metadata,
        created_at=proof.created_at,
        reviewed_at=proof.reviewed_at,
        expires_at=proof.expires_at,
    )


async def claim_to_response(
    db: aiosqlite.Connection,
    claim: Any,
    entry: Any,
) -> ProfileClaimResponse:
    """Convert a claim record into its public API schema."""
    proofs = await ProfileClaimCRUD.list_proofs(db, claim.id)
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
        proofs=[proof_to_response(proof) for proof in proofs],
        linked_atproto_handle=entry.linked_atproto_handle,
        linked_atproto_did=entry.linked_atproto_did,
        linked_atproto_verified_at=entry.linked_atproto_verified_at,
        verified_at=claim.verified_at,
        rejected_reason=claim.rejected_reason,
        created_at=claim.created_at,
        updated_at=claim.updated_at,
    )


def claim_evidence_payload(payload: ProfileClaimRequest) -> dict[str, str] | str | None:
    """Return the stored evidence payload for a verification request."""
    structured = {
        "relationship": _blank_to_none(payload.relationship),
        "evidence": _blank_to_none(payload.evidence),
        "requested_changes": _blank_to_none(payload.requested_changes),
        "preferred_contact_channel": _blank_to_none(payload.preferred_contact_channel),
        "private_note": _blank_to_none(payload.private_note),
    }
    intent = {key: value for key, value in structured.items() if value is not None}
    return intent or None


def claim_domain_verification_host(domain: str) -> str:
    """Return the TXT host used for a profile domain proof."""
    return f"_atlas-claim.{domain}"


def claim_domain_challenge() -> str:
    """Return a new DNS challenge value for a profile domain proof."""
    return f"atlas-profile-claim={secrets.token_urlsafe(24)}"


async def verify_claim_with_entry(
    db: aiosqlite.Connection,
    claim_id: str,
    *,
    proof_type: str,
    proof_summary: str,
    proof_metadata: dict[str, object],
) -> ProfileClaimModel:
    """Mark a claim and entry as verified by a proof."""
    verified = await ProfileClaimCRUD.mark_verified(
        db,
        claim_id,
        proof_type=proof_type,
        proof_summary=proof_summary,
        proof_metadata=proof_metadata,
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
    return verified


async def apply_dns_claim_proof(
    db: aiosqlite.Connection,
    *,
    claim_id: str,
    entry: Any,
    domain: str,
) -> None:
    """Attach a pending DNS domain proof to a profile claim."""
    normalized_domain = domain.strip().lower()
    if normalized_domain not in entry_claim_domains(entry):
        raise HTTPException(status_code=400, detail="Domain is not listed on this profile.")
    challenge_value = claim_domain_challenge()
    await ProfileClaimCRUD.record_proof(
        db,
        claim_id=claim_id,
        proof_type="domain_dns",
        proof_status="pending",
        proof_summary=f"Waiting for DNS record at {claim_domain_verification_host(normalized_domain)}.",
        proof_metadata={
            "domain": normalized_domain,
            "challenge_host": claim_domain_verification_host(normalized_domain),
            "challenge_value": challenge_value,
            "entry_domains": sorted(entry_claim_domains(entry)),
        },
    )


async def apply_workspace_claim_proof(  # noqa: PLR0913
    db: aiosqlite.Connection,
    *,
    claim_id: str,
    entry: Any,
    actor: AuthenticatedActor,
    settings: Settings,
    membership: MembershipResult | None = None,
) -> tuple[str, dict[str, object]] | None:
    """Attach workspace-admin evidence to a profile claim."""
    if actor.org_id is None:
        raise HTTPException(status_code=400, detail="Active workspace is required.")
    membership = membership or await verify_org_membership(actor.user_id, actor.org_id, settings)
    if membership is None:
        raise HTTPException(status_code=403, detail="Active workspace membership was not found.")

    entry_domains = entry_claim_domains(entry)
    matching_verified_domains = [
        domain
        for domain in membership.verified_sso_domains
        if _domain_matches_entry_domains(domain, entry_domains)
    ]
    role_can_manage = membership.role in {"admin", "owner"}
    metadata: dict[str, object] = {
        "workspace_id": actor.org_id,
        "workspace_slug": membership.slug,
        "workspace_name": membership.name,
        "workspace_role": membership.role,
        "workspace_domain": membership.workspace_domain,
        "verified_sso_domains": membership.verified_sso_domains,
        "matching_verified_domains": matching_verified_domains,
        "entry_domains": sorted(entry_domains),
        "role_can_manage": role_can_manage,
    }
    if role_can_manage and matching_verified_domains:
        return (f"Verified workspace admin domain {matching_verified_domains[0]}.", metadata)
    await ProfileClaimCRUD.record_proof(
        db,
        claim_id=claim_id,
        proof_type="sso_admin",
        proof_status="pending",
        proof_summary="Workspace evidence is pending review.",
        proof_metadata=metadata,
    )
    return None


async def validate_workspace_claim_backing(
    actor: AuthenticatedActor,
    settings: Settings,
) -> MembershipResult:
    """Reject workspace proof requests whose active workspace cannot be verified."""
    if actor.org_id is None:
        raise HTTPException(status_code=400, detail="Active workspace is required.")
    membership = await verify_org_membership(actor.user_id, actor.org_id, settings)
    if membership is None:
        raise HTTPException(status_code=403, detail="Active workspace membership was not found.")
    return membership


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _domain_matches_entry_domains(domain: str, entry_domains: set[str]) -> bool:
    normalized = domain.strip().lower()
    return any(
        normalized == entry_domain or normalized.endswith(f".{entry_domain}")
        for entry_domain in entry_domains
    )
