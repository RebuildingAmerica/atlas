"""Attaching an identity to a profile, and revalidating one later."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.api.profile_claim_atproto_helpers import (
    apply_atproto_claim_proof,
    link_atproto_proof_if_present,
    link_entry_atproto_identity,
)
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_controls import (
    AtprotoIdentityControlCRUD,
)
from atlas.domains.catalog.models.profile_atproto_links import (
    ProfileAtprotoLinkCRUD,
    ProfileAtprotoLinkEvidence,
)
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.services.atproto_identity import (
    revalidate_linked_atproto_profiles,
)
from atlas.domains.catalog.services.profile_claims import ProfileClaimPolicy
from atlas.models import EntryCRUD
from tests.domains.catalog.atproto_identity_support import (
    _Resolver,
)


@pytest.mark.asyncio
async def test_atproto_claim_helpers_reject_missing_or_unbacked_identity(
    test_db: object,
    claimable_org: str,
) -> None:
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    actor = SimpleNamespace(user_id="local-operator")
    claim = await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_org,
        user_id="local-operator",
        user_email="operator@atlas.test",
        tier=2,
        evidence={"evidence": "I manage this organization."},
    )

    with pytest.raises(HTTPException) as missing_identity:
        await apply_atproto_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            actor=actor,
            identity_id="missing",
            claim_policy=ProfileClaimPolicy(),
            has_organization_backing=True,
        )
    assert missing_identity.value.status_code == 404
    assert missing_identity.value.detail == "Linked ATProto identity not found."

    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="local-operator",
        did="did:plc:generic",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )
    with pytest.raises(HTTPException) as unbacked_identity:
        await apply_atproto_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            actor=actor,
            identity_id=identity.id,
            claim_policy=ProfileClaimPolicy(),
            has_organization_backing=False,
        )
    assert unbacked_identity.value.status_code == 400
    assert unbacked_identity.value.detail.startswith("Add the organization domain")


@pytest.mark.asyncio
async def test_link_atproto_proof_ignores_incomplete_or_stale_metadata(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claim = await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_org,
        user_id="local-operator",
        user_email="operator@atlas.test",
        tier=2,
        evidence={"evidence": "I manage this organization."},
    )
    incomplete = await ProfileClaimCRUD.record_proof(
        test_db,
        claim_id=claim.id,
        proof_type="atproto",
        proof_status="pending",
        proof_summary="Linked ATProto handle.",
        proof_metadata={"did": "did:plc:generic"},
    )

    await link_atproto_proof_if_present(
        test_db,
        claim.id,
        claimable_org,
        verified_at="2026-07-10T12:00:00Z",
    )

    proofs = await ProfileClaimCRUD.list_proofs(test_db, claim.id)
    assert next(proof for proof in proofs if proof.id == incomplete.id).proof_status == "pending"

    stale = await ProfileClaimCRUD.record_proof(
        test_db,
        claim_id=claim.id,
        proof_type="atproto",
        proof_status="pending",
        proof_summary="Linked ATProto handle.",
        proof_metadata={"identity_id": "missing"},
    )

    async def stale_identity(_handle: str, _did: str) -> bool:
        return False

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_linked_atproto_identity",
        stale_identity,
    )

    await link_atproto_proof_if_present(
        test_db,
        claim.id,
        claimable_org,
        verified_at="2026-07-10T12:00:00Z",
    )

    proofs = await ProfileClaimCRUD.list_proofs(test_db, claim.id)
    assert next(proof for proof in proofs if proof.id == stale.id).proof_status == "pending"


@pytest.mark.asyncio
async def test_revalidate_linked_atproto_profiles_marks_stale_link_for_attention(
    test_db: object,
    claimable_org: str,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(test_db, did="did:plc:org", handle="org.example")
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        identity_id=identity.id,
        evidence=ProfileAtprotoLinkEvidence(verified_at="2026-07-07T12:00:00Z"),
    )
    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="user_1",
        claim_verified_at="2026-07-07T12:00:00Z",
    )
    resolver = _Resolver(
        did="did:plc:other",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )

    result = await revalidate_linked_atproto_profiles(test_db, resolver=resolver)

    assert result.checked == 1
    assert result.needs_attention == 1
    refreshed = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert refreshed is not None
    assert refreshed.claim_status == "verified"
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.status == "reverification_required"
    stale_identity = await AtprotoIdentityCRUD.get_by_id(test_db, identity.id)
    assert stale_identity is not None
    assert stale_identity.resolution_status == "needs_attention"


@pytest.mark.asyncio
async def test_revalidate_linked_atproto_profiles_keeps_current_public_link(
    test_db: object,
    claimable_org: str,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(test_db, did="did:plc:org", handle="org.example")
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        identity_id=identity.id,
        evidence=ProfileAtprotoLinkEvidence(verified_at="2026-07-07T12:00:00Z"),
    )
    resolver = _Resolver(
        did="did:plc:org",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )

    result = await revalidate_linked_atproto_profiles(test_db, resolver=resolver)

    assert result.checked == 1
    assert result.needs_attention == 0
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.status == "verified"
    public_identity = await ProfileAtprotoLinkCRUD.get_verified_public_identity(
        test_db, claimable_org
    )
    assert public_identity is not None
    assert public_identity.handle == "org.example"


@pytest.mark.asyncio
async def test_revalidation_skips_orphaned_profile_link(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db, did="did:plc:orphan", handle="orphan.example"
    )
    await ProfileAtprotoLinkCRUD.attach(test_db, entry_id=claimable_org, identity_id=identity.id)

    async def missing(_conn: object, _identity_id: str) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_id", missing)
    result = await revalidate_linked_atproto_profiles(test_db)
    assert result.checked == 0
    assert result.needs_attention == 0
