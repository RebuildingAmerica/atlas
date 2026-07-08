"""Tests for ATProto proof linked with domain-backed organization verification."""

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.access.membership import MembershipResult
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


async def _stale_atproto_identity(_handle: str, _did: str) -> bool:
    return False


@pytest.mark.asyncio
async def test_generic_atproto_handle_links_when_workspace_domain_verifies(
    test_client: object,
    test_db: object,
    test_settings: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_settings.deploy_mode = "hosted"
    test_settings.auth_internal_secret = "test-secret"
    test_settings.auth_membership_verification_url = "https://app.example"
    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_current_atproto_identity",
        _valid_atproto_identity,
    )
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        user_id="user_1",
        did="did:plc:generic",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )

    membership_checks = 0

    async def fake_verify_org_membership(
        _user_id: str,
        _org_id: str,
        _settings: object,
    ) -> MembershipResult:
        nonlocal membership_checks
        membership_checks += 1
        return MembershipResult(
            role="owner",
            slug="mississippi-rising",
            name="Mississippi Rising",
            workspace_type="team",
            active_products=["atlas_team"],
            workspace_domain="mississippirising.org",
            verified_sso_domains=["mississippirising.org"],
        )

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_helpers.verify_org_membership",
        fake_verify_org_membership,
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        headers={
            "X-Atlas-Internal-Secret": "test-secret",
            "X-Atlas-Actor-Id": "user_1",
            "X-Atlas-Actor-Email": "operator@example.net",
            "X-Atlas-Organization-Id": "workspace_1",
        },
        json={
            "atproto_identity_id": identity.id,
            "use_active_workspace": True,
        },
    )

    assert response.status_code == status.HTTP_201_CREATED, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["linked_atproto_handle"] == "mississippi-rising.bsky.social"
    proofs = {proof["proof_type"]: proof["proof_status"] for proof in body["proofs"]}
    assert proofs["atproto"] == "verified"
    assert proofs["sso_admin"] == "verified"

    detail = await test_client.get(f"/api/entities/{claimable_org}")
    assert detail.status_code == status.HTTP_200_OK
    assert detail.json()["claim"]["linked_atproto_handle"] == "mississippi-rising.bsky.social"
    assert membership_checks == 1


@pytest.mark.asyncio
async def test_stale_atproto_handle_does_not_link_when_workspace_domain_verifies(
    test_client: object,
    test_db: object,
    test_settings: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_settings.deploy_mode = "hosted"
    test_settings.auth_internal_secret = "test-secret"
    test_settings.auth_membership_verification_url = "https://app.example"
    verification_results = [_valid_atproto_identity, _stale_atproto_identity]

    async def changing_identity(handle: str, did: str) -> bool:
        verifier = verification_results.pop(0)
        return await verifier(handle, did)

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_current_atproto_identity",
        changing_identity,
    )
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        user_id="user_1",
        did="did:plc:generic",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )

    async def fake_verify_org_membership(
        _user_id: str,
        _org_id: str,
        _settings: object,
    ) -> MembershipResult:
        return MembershipResult(
            role="owner",
            slug="mississippi-rising",
            name="Mississippi Rising",
            workspace_type="team",
            active_products=["atlas_team"],
            workspace_domain="mississippirising.org",
            verified_sso_domains=["mississippirising.org"],
        )

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_helpers.verify_org_membership",
        fake_verify_org_membership,
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        headers={
            "X-Atlas-Internal-Secret": "test-secret",
            "X-Atlas-Actor-Id": "user_1",
            "X-Atlas-Actor-Email": "operator@example.net",
            "X-Atlas-Organization-Id": "workspace_1",
        },
        json={
            "atproto_identity_id": identity.id,
            "use_active_workspace": True,
        },
    )

    assert response.status_code == status.HTTP_201_CREATED, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["linked_atproto_handle"] is None
    proofs = {proof["proof_type"]: proof["proof_status"] for proof in body["proofs"]}
    assert proofs["atproto"] == "pending"
    assert proofs["sso_admin"] == "verified"
    assert verification_results == []


@pytest.mark.asyncio
async def test_generic_atproto_handle_links_when_dns_domain_verifies(
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
        did="did:plc:dnsgeneric",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )

    class FakeClaimDnsResolver:
        async def resolve_txt_records(self, _domain: str) -> set[str]:
            return {challenge}

    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
    claim_response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={
            "atproto_identity_id": identity.id,
            "dns_domain": "mississippirising.org",
            "evidence": "I control the organization website and social account.",
        },
    )
    assert claim_response.status_code == status.HTTP_201_CREATED, claim_response.text
    claim = claim_response.json()
    dns_proof = next(proof for proof in claim["proofs"] if proof["proof_type"] == "domain_dns")
    challenge = dns_proof["metadata"]["challenge_value"]
    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claims.DnsProfileClaimTxtResolver",
        FakeClaimDnsResolver,
    )

    verify_response = await test_client.post(
        f"/api/profiles/{slug}/claims/{claim['id']}/verify-domain",
        json={},
    )

    assert verify_response.status_code == status.HTTP_200_OK, verify_response.text
    verified = verify_response.json()
    assert verified["status"] == "verified"
    assert verified["linked_atproto_handle"] == "mississippi-rising.bsky.social"
    proofs = {proof["proof_type"]: proof for proof in verified["proofs"]}
    atproto_metadata = proofs["atproto"]["metadata"]
    assert atproto_metadata["handle_is_generic"] is True
    assert atproto_metadata["handle_domain_matches_entry"] is False
    assert proofs["atproto"]["proof_status"] == "verified"
    assert proofs["domain_dns"]["proof_status"] == "verified"


@pytest.mark.asyncio
async def test_generic_atproto_handle_requires_domain_or_workspace_backing(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_identity_check(_handle: str, _did: str) -> bool:
        raise AssertionError

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_current_atproto_identity",
        fail_identity_check,
    )
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        user_id="local-operator",
        did="did:plc:generic-alone",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={
            "atproto_identity_id": identity.id,
            "evidence": "I control the social account.",
        },
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == (
        "Add the organization domain or workspace role before submitting this ATProto account."
    )
    assert await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org) is None
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry.claim_status == "unclaimed"
