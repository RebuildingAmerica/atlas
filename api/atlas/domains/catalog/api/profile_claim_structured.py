"""Structured proof orchestration for profile verification."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

from atlas.domains.catalog.api.profile_claim_atproto_helpers import (
    apply_atproto_claim_proof,
    link_entry_atproto_identity_if_current,
    mark_atproto_proof_verified_if_present,
)
from atlas.domains.catalog.api.profile_claim_helpers import (
    apply_dns_claim_proof,
    apply_workspace_claim_proof,
    validate_workspace_claim_backing,
    verify_claim_with_entry,
)
from atlas.domains.catalog.models.atproto_identities import (
    AtprotoIdentityCRUD,
    AtprotoIdentityModel,
)
from atlas.domains.catalog.services.profile_claims import ProfileClaimPolicy, entry_claim_domains
from atlas.models import EntryCRUD

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.membership import MembershipResult
    from atlas.domains.access.principals import AuthenticatedActor
    from atlas.domains.catalog.models.profile_claims import ProfileClaimModel
    from atlas.domains.catalog.schemas.public import ProfileClaimRequest
    from atlas.platform.config import Settings


async def validate_atproto_organization_backing(  # noqa: PLR0913
    db: aiosqlite.Connection,
    *,
    entry: Any,
    actor: AuthenticatedActor,
    identity_id: str,
    claim_policy: ProfileClaimPolicy,
    has_organization_backing: bool,
) -> None:
    """Reject weak organization ATProto proof before a claim row is created."""
    identity = await AtprotoIdentityCRUD.get_by_id(db, identity_id)
    if identity is None or identity.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="Linked ATProto identity not found.")
    domain_matches = claim_policy.atproto_handle_domain_matches_entry(
        entry, identity.current_handle
    )
    if entry.type == "organization" and not domain_matches and not has_organization_backing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Add the organization domain or workspace role before submitting this "
                "ATProto account."
            ),
        )


def validate_dns_domain_backing(entry: Any, domain: str) -> None:
    """Reject DNS record requests for domains not listed on the profile."""
    if domain.strip().lower() not in entry_claim_domains(entry):
        raise HTTPException(status_code=400, detail="Domain is not listed on this profile.")


async def validate_workspace_backing(
    actor: AuthenticatedActor,
    settings: Settings,
) -> MembershipResult:
    """Reject workspace proof requests that have no active workspace context."""
    if actor.org_id is None:
        raise HTTPException(status_code=400, detail="Active workspace is required.")
    return await validate_workspace_claim_backing(actor, settings)


async def apply_structured_proofs(  # noqa: PLR0913
    db: aiosqlite.Connection,
    *,
    claim: ProfileClaimModel,
    entry: Any,
    payload: ProfileClaimRequest,
    actor: AuthenticatedActor,
    claim_policy: ProfileClaimPolicy,
    settings: Settings,
    workspace_membership: MembershipResult | None = None,
) -> ProfileClaimModel:
    """Apply submitted ATProto, DNS, and workspace proof to one claim."""
    linked_identity: AtprotoIdentityModel | None = None
    auto_verify_proof = None
    has_organization_backing = payload.dns_domain is not None or payload.use_active_workspace
    if payload.atproto_identity_id is not None:
        linked_identity, auto_verify_proof = await _apply_atproto_structured_proof(
            db,
            claim=claim,
            entry=entry,
            actor=actor,
            identity_id=payload.atproto_identity_id,
            claim_policy=claim_policy,
            has_organization_backing=has_organization_backing,
        )
    if payload.dns_domain is not None:
        await apply_dns_claim_proof(db, claim_id=claim.id, entry=entry, domain=payload.dns_domain)
    if payload.use_active_workspace:
        workspace_proof = await apply_workspace_claim_proof(
            db,
            claim_id=claim.id,
            entry=entry,
            actor=actor,
            settings=settings,
            membership=workspace_membership,
        )
        if workspace_proof is not None:
            proof_summary, proof_metadata = workspace_proof
            auto_verify_proof = ("sso_admin", proof_summary, proof_metadata)

    if auto_verify_proof is None:
        await EntryCRUD.update(
            db,
            entry.id,
            claim_status="pending",
            claimed_by_user_id=actor.user_id,
        )
        return claim

    proof_type, proof_summary, proof_metadata = auto_verify_proof
    verified_claim = await verify_claim_with_entry(
        db,
        claim.id,
        proof_type=proof_type,
        proof_summary=proof_summary,
        proof_metadata=proof_metadata,
    )
    if linked_identity is not None:
        linked = await link_entry_atproto_identity_if_current(
            db,
            entry.id,
            did=linked_identity.did,
            handle=linked_identity.current_handle,
            verified_at=verified_claim.verified_at,
        )
        if linked:
            await mark_atproto_proof_verified_if_present(db, claim.id)
    return verified_claim


async def _apply_atproto_structured_proof(  # noqa: PLR0913
    db: aiosqlite.Connection,
    *,
    claim: ProfileClaimModel,
    entry: Any,
    actor: AuthenticatedActor,
    identity_id: str,
    claim_policy: ProfileClaimPolicy,
    has_organization_backing: bool,
) -> tuple[AtprotoIdentityModel, tuple[str, str, dict[str, object]] | None]:
    linked_identity, should_verify = await apply_atproto_claim_proof(
        db,
        claim_id=claim.id,
        entry=entry,
        actor=actor,
        identity_id=identity_id,
        claim_policy=claim_policy,
        has_organization_backing=has_organization_backing,
    )
    if not should_verify:
        return linked_identity, None
    return (
        linked_identity,
        (
            "atproto",
            f"Verified ATProto handle {linked_identity.current_handle}.",
            {
                "did": linked_identity.did,
                "handle": linked_identity.current_handle,
                "pds_url": linked_identity.pds_url,
                "entry_domains": sorted(entry_claim_domains(entry)),
            },
        ),
    )
