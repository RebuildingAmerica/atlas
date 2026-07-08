"""Tests for reviewer decisions on pending profile verifications."""

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.catalog.api.profile_claim_atproto_helpers import link_entry_atproto_identity
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.services.atproto_identity import revalidate_linked_atproto_profiles
from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


@pytest.mark.asyncio
async def test_review_list_returns_pending_profile_claims(
    test_client: object,
    test_db: object,
    claimable_person: str,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={
            "evidence": "My staff page identifies me.",
            "requested_changes": "Update my current role.",
        },
    )

    response = await test_client.get("/api/profiles/claims/review")

    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == claim_response.json()["id"]
    assert body["items"][0]["entry_slug"] == slug
    assert body["items"][0]["evidence"]["requested_changes"] == "Update my current role."


@pytest.mark.asyncio
async def test_review_list_excludes_email_token_claims(
    test_client: object,
    test_db: object,
    claimable_org: str,
) -> None:
    await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
    claim_response = await test_client.post(f"/api/profiles/{slug}/claim", json={})
    assert claim_response.status_code == status.HTTP_201_CREATED

    response = await test_client.get("/api/profiles/claims/review")

    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_reviewer_approval_verifies_claim_and_links_pending_atproto_proof(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_current_atproto_identity",
        _valid_atproto_identity,
    )
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        user_id="local-operator",
        did="did:plc:generic",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={
            "atproto_identity_id": identity.id,
            "dns_domain": "mississippirising.org",
            "evidence": "The social profile links back to our public website.",
        },
    )
    claim_id = claim_response.json()["id"]

    response = await test_client.post(
        f"/api/profiles/claims/review/{claim_id}/approve",
        json={"note": "Website and social profile match."},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["linked_atproto_handle"] == "mississippi-rising.bsky.social"
    assert body["linked_atproto_did"] == "did:plc:generic"
    assert any(proof["proof_type"] == "manual_review" for proof in body["proofs"])
    assert any(
        proof["proof_type"] == "atproto" and proof["proof_status"] == "verified"
        for proof in body["proofs"]
    )
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    assert entry.claim_status == "verified"
    assert entry.claimed_by_user_id == "local-operator"


@pytest.mark.asyncio
async def test_reviewer_rejection_returns_profile_to_unclaimed_state(
    test_client: object,
    test_db: object,
    claimable_person: str,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "This is my profile."},
    )
    claim_id = claim_response.json()["id"]

    response = await test_client.post(
        f"/api/profiles/claims/review/{claim_id}/reject",
        json={"note": "Evidence does not identify the requester."},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["status"] == "rejected"
    assert body["rejected_reason"] == "Evidence does not identify the requester."
    entry = await EntryCRUD.get_by_id(test_db, claimable_person)
    assert entry is not None
    assert entry.claim_status == "unclaimed"
    assert entry.claimed_by_user_id is None


@pytest.mark.asyncio
async def test_reviewer_rejection_preserves_another_pending_claim(
    test_client: object,
    test_db: object,
    claimable_person: str,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "This is my profile."},
    )
    first_claim_id = claim_response.json()["id"]
    second_claim = await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_person,
        user_id="second-user",
        user_email="second@example.org",
        tier=2,
        evidence={"evidence": "My staff page lists this profile."},
    )

    response = await test_client.post(
        f"/api/profiles/claims/review/{first_claim_id}/reject",
        json={"note": "Evidence does not identify the requester."},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    entry = await EntryCRUD.get_by_id(test_db, claimable_person)
    assert entry is not None
    assert entry.claim_status == "pending"
    assert entry.claimed_by_user_id == second_claim.user_id


@pytest.mark.asyncio
async def test_reviewer_decision_rejects_non_pending_claim(
    test_client: object,
    test_db: object,
    claimable_org: str,
) -> None:
    await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
    await test_client.post(f"/api/profiles/{slug}/claim", json={})
    claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
    assert claim is not None
    assert claim.verification_token is not None
    await test_client.post(
        "/api/profiles/claims/verify-email",
        json={"token": claim.verification_token},
    )

    response = await test_client.post(
        f"/api/profiles/claims/review/{claim.id}/reject",
        json={"note": "No longer pending."},
    )

    assert response.status_code == status.HTTP_409_CONFLICT


@pytest.mark.asyncio
async def test_reviewer_can_revalidate_linked_atproto_profiles(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        did="did:plc:stale",
        handle="mississippi-rising.bsky.social",
        verified_at="2026-07-07T12:00:00Z",
    )
    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="local-operator",
        claim_verified_at="2026-07-07T12:00:00Z",
    )

    async def revalidate_stale_profiles(db: object) -> object:
        return await revalidate_linked_atproto_profiles(
            db,
            resolver=_StaleAtprotoResolver(),
        )

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_review.revalidate_linked_atproto_profiles",
        revalidate_stale_profiles,
    )

    response = await test_client.post("/api/profiles/claims/review/atproto/revalidate")

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json() == {"checked": 1, "cleared": 1}
    refreshed = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert refreshed is not None
    assert refreshed.claim_status == "verified"
    assert refreshed.linked_atproto_handle is None


class _StaleAtprotoResolver:
    async def handle_resolves_to_did(self, _handle: str) -> str | None:
        return "did:plc:other"

    async def did_document(self, did: str) -> dict[str, object]:
        return {"id": did, "alsoKnownAs": ["at://mississippi-rising.bsky.social"]}
