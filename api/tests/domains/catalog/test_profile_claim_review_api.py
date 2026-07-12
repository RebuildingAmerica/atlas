"""Tests for reviewer decisions on pending profile verifications."""

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.catalog.api import profile_claim_review
from atlas.domains.catalog.api.profile_claim_atproto_helpers import link_entry_atproto_identity
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.profile_atproto_links import (
    ProfileAtprotoLinkCRUD,
    ProfileAtprotoLinkEvidence,
)
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
async def test_review_list_skips_claims_whose_profile_disappeared(
    test_client: object,
    test_db: object,
    claimable_person: str,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "My staff page identifies me."},
    )
    assert claim_response.status_code == status.HTTP_201_CREATED
    claim = await ProfileClaimCRUD.get_by_id(test_db, claim_response.json()["id"])
    assert claim is not None

    async def list_missing_entry_claims(*_args: object, **_kwargs: object) -> list[object]:
        return [claim]

    async def count_missing_entry_claims(*_args: object, **_kwargs: object) -> int:
        return 1

    async def missing_entry(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        profile_claim_review,
        "list_pending_profile_claim_reviews",
        list_missing_entry_claims,
    )
    monkeypatch.setattr(
        profile_claim_review,
        "count_pending_profile_claim_reviews",
        count_missing_entry_claims,
    )
    monkeypatch.setattr(profile_claim_review.EntryCRUD, "get_by_id", missing_entry)

    try:
        response = await test_client.get("/api/profiles/claims/review")
    finally:
        monkeypatch.undo()

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json() == {"items": [], "total": 1}


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
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="local-operator",
        did="did:plc:generic",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )
    await test_db.commit()
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
async def test_reviewer_rejection_without_note_uses_default_reason(
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
        json={},
    )

    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json()["rejected_reason"] == "Reviewer could not confirm this representative."


@pytest.mark.asyncio
async def test_reviewer_decision_rejects_missing_claim(
    test_client: object,
) -> None:
    response = await test_client.post(
        "/api/profiles/claims/review/missing-claim/reject",
        json={"note": "No claim."},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Claim not found"


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
async def test_reviewer_decision_rejects_claim_without_profile(
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

    async def missing_entry(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(profile_claim_review.EntryCRUD, "get_by_id", missing_entry)
    try:
        response = await test_client.post(
            f"/api/profiles/claims/review/{claim_id}/approve",
            json={"note": "Profile disappeared."},
        )
    finally:
        monkeypatch.undo()

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Profile not found"


@pytest.mark.asyncio
async def test_reviewer_approval_reports_profile_deleted_after_verification(
    test_client: object,
    test_db: object,
    claimable_person: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = await EntryCRUD.get_by_id(test_db, claimable_person)
    assert entry is not None
    claim_response = await test_client.post(
        f"/api/profiles/{entry.slug}/claim",
        json={"evidence": "This is my profile."},
    )
    claim_id = claim_response.json()["id"]
    calls = 0

    async def entry_then_missing(*_args: object, **_kwargs: object) -> object | None:
        nonlocal calls
        calls += 1
        return entry if calls == 1 else None

    monkeypatch.setattr(profile_claim_review.EntryCRUD, "get_by_id", entry_then_missing)

    response = await test_client.post(
        f"/api/profiles/claims/review/{claim_id}/approve",
        json={"note": "Verified."},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Profile not found"


@pytest.mark.asyncio
async def test_reviewer_rejection_reports_profile_deleted_after_decision(
    test_client: object,
    test_db: object,
    claimable_person: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = await EntryCRUD.get_by_id(test_db, claimable_person)
    assert entry is not None
    claim_response = await test_client.post(
        f"/api/profiles/{entry.slug}/claim",
        json={"evidence": "This is my profile."},
    )
    claim_id = claim_response.json()["id"]
    calls = 0

    async def entry_then_missing(*_args: object, **_kwargs: object) -> object | None:
        nonlocal calls
        calls += 1
        return entry if calls == 1 else None

    monkeypatch.setattr(profile_claim_review.EntryCRUD, "get_by_id", entry_then_missing)

    response = await test_client.post(
        f"/api/profiles/claims/review/{claim_id}/reject",
        json={"note": "Rejected."},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Profile not found"


@pytest.mark.asyncio
async def test_reviewer_rejection_reports_vanished_claim(
    test_client: object,
    test_db: object,
    claimable_person: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "This is my profile."},
    )
    claim_id = claim_response.json()["id"]

    async def missing_rejected_claim(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(ProfileClaimCRUD, "mark_rejected", missing_rejected_claim)

    response = await test_client.post(
        f"/api/profiles/claims/review/{claim_id}/reject",
        json={"note": "Evidence does not identify the requester."},
    )

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert response.json()["detail"] == "Failed to reject claim."


@pytest.mark.asyncio
async def test_reviewer_can_revalidate_linked_atproto_profiles(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:stale",
        handle="mississippi-rising.bsky.social",
    )
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
    assert response.json() == {"checked": 1, "needs_attention": 1}
    refreshed = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert refreshed is not None
    assert refreshed.claim_status == "verified"
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.status == "reverification_required"


class _StaleAtprotoResolver:
    async def handle_resolves_to_did(self, _handle: str) -> str | None:
        return "did:plc:other"

    async def did_document(self, did: str) -> dict[str, object]:
        return {"id": did, "alsoKnownAs": ["at://mississippi-rising.bsky.social"]}
