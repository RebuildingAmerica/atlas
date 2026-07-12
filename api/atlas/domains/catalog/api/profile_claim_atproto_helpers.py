"""ATProto helpers for profile verification routes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

from atlas.domains.catalog.models.atproto_identities import (
    AtprotoIdentityCRUD,
    AtprotoIdentityModel,
)
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.profile_atproto_links import (
    ProfileAtprotoLinkCRUD,
    ProfileAtprotoLinkEvidence,
)
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.services.atproto_identity import verify_current_atproto_identity
from atlas.domains.catalog.services.profile_claims import ProfileClaimPolicy, entry_claim_domains

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor


async def link_entry_atproto_identity(
    db: aiosqlite.Connection,
    entry_id: str,
    *,
    identity_id: str,
    evidence: ProfileAtprotoLinkEvidence | None = None,
) -> None:
    """Attach the verified ATProto identity displayed on a public profile."""
    await ProfileAtprotoLinkCRUD.attach(
        db,
        entry_id=entry_id,
        identity_id=identity_id,
        evidence=evidence,
    )
    await db.commit()


async def link_entry_atproto_identity_if_current(
    db: aiosqlite.Connection,
    entry_id: str,
    *,
    identity_id: str,
    evidence: ProfileAtprotoLinkEvidence | None = None,
) -> bool:
    """Attach an ATProto identity only while its public handle/DID still agree."""
    identity = await AtprotoIdentityCRUD.get_by_id(db, identity_id)
    if identity is None or not await verify_current_atproto_identity(
        identity.current_handle, identity.did
    ):
        return False
    await link_entry_atproto_identity(
        db,
        entry_id,
        identity_id=identity.id,
        evidence=evidence,
    )
    return True


async def link_atproto_proof_if_present(
    db: aiosqlite.Connection,
    claim_id: str,
    entry_id: str,
    *,
    verified_at: str | None,
) -> None:
    """Link a pending ATProto proof after another strong proof verifies the claim."""
    proofs = await ProfileClaimCRUD.list_proofs(db, claim_id)
    atproto_proof = next((proof for proof in proofs if proof.proof_type == "atproto"), None)
    if atproto_proof is None or not isinstance(atproto_proof.metadata, dict):
        return
    identity_id = atproto_proof.metadata.get("identity_id")
    if not isinstance(identity_id, str):
        return
    linked = await link_entry_atproto_identity_if_current(
        db,
        entry_id,
        identity_id=identity_id,
        evidence=ProfileAtprotoLinkEvidence(
            claim_id=claim_id,
            proof_id=atproto_proof.id,
            verified_at=verified_at,
        ),
    )
    if not linked:
        return
    await ProfileClaimCRUD.mark_proof_verified(
        db,
        atproto_proof.id,
        proof_metadata=atproto_proof.metadata,
    )


async def mark_atproto_proof_verified_if_present(
    db: aiosqlite.Connection,
    claim_id: str,
) -> None:
    """Mark an OAuth-linked ATProto proof verified after paired organization proof."""
    proofs = await ProfileClaimCRUD.list_proofs(db, claim_id)
    atproto_proof = next(
        (
            proof
            for proof in proofs
            if proof.proof_type == "atproto" and proof.proof_status == "pending"
        ),
        None,
    )
    if atproto_proof is not None:
        await ProfileClaimCRUD.mark_proof_verified(
            db,
            atproto_proof.id,
            proof_metadata=atproto_proof.metadata,
        )


async def apply_atproto_claim_proof(  # noqa: PLR0913
    db: aiosqlite.Connection,
    *,
    claim_id: str,
    entry: Any,
    actor: AuthenticatedActor,
    identity_id: str,
    claim_policy: ProfileClaimPolicy,
    has_organization_backing: bool,
) -> tuple[AtprotoIdentityModel, bool]:
    """Attach ATProto proof to a profile claim."""
    identity = await AtprotoIdentityCRUD.get_by_id(db, identity_id)
    control = await AtprotoIdentityControlCRUD.get_active_for_user_and_identity(
        db, user_id=actor.user_id, identity_id=identity_id
    )
    if identity is None or control is None:
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
    if not await verify_current_atproto_identity(identity.current_handle, identity.did):
        raise HTTPException(
            status_code=409,
            detail="Reconnect this ATProto account before using it for verification.",
        )
    proof_metadata: dict[str, object] = {
        "identity_id": identity.id,
        "did": identity.did,
        "handle": identity.current_handle,
        "handle_is_generic": is_generic_atproto_handle(identity.current_handle),
        "pds_url": identity.pds_url,
        "handle_domain_matches_entry": domain_matches,
        "entry_domains": sorted(entry_claim_domains(entry)),
    }
    if domain_matches:
        return identity, True
    await ProfileClaimCRUD.record_proof(
        db,
        claim_id=claim_id,
        proof_type="atproto",
        proof_status="pending",
        proof_summary=f"Linked ATProto handle {identity.current_handle}.",
        proof_metadata=proof_metadata,
    )
    return identity, False


def is_generic_atproto_handle(handle: str) -> bool:
    """Return whether a handle is hosted on the shared Bluesky domain."""
    return handle.strip().lower().removeprefix("@").endswith(".bsky.social")
