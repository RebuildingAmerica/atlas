"""Tests for the public profile claim API flow."""
# ruff: noqa: PLR2004

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from atlas.domains.access.membership import MembershipResult
from atlas.domains.catalog.api import profile_claims as profile_claims_api
from atlas.domains.catalog.api.profile_claim_helpers import (
    apply_dns_claim_proof,
    apply_workspace_claim_proof,
    validate_workspace_claim_backing,
    verify_claim_with_entry,
)
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

    @pytest.mark.asyncio
    async def test_initiate_claim_tier_one_uses_email_domain_match(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        # In local deploy_mode the build_local_actor returns a fixed email; so we
        # construct a tier-1 entry whose email domain matches that local actor.
        # The default local actor email is "operator@atlas.test" — adjust the
        # entry to match for this test.
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        resp = await test_client.post(
            f"/api/profiles/{(await EntryCRUD.get_by_id(test_db, claimable_org)).slug}/claim",
            json={},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == 1
        assert body["status"] == "pending"

        # Entry's claim_status flips to pending and records claimed_by_user_id
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.claim_status == "pending"
        assert entry.claimed_by_user_id is not None

    @pytest.mark.asyncio
    async def test_initiate_claim_tier_two_requires_evidence(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 400

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim", json={"evidence": "I am Marcus, see linkedin."}
        )
        assert resp.status_code == 201
        assert resp.json()["tier"] == 2

    @pytest.mark.asyncio
    async def test_initiate_person_claim_stays_manual_even_with_matching_email_domain(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        """Person claims never auto-verify from email-domain proof alone."""
        await EntryCRUD.update(
            test_db,
            claimable_person,
            email="marcus@atlas.rebuildingus.org",
            website="https://atlas.rebuildingus.org/marcus",
        )
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug

        missing_evidence_resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert missing_evidence_resp.status_code == 400

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "Official bio confirms I am Marcus."},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["tier"] == 2

    @pytest.mark.asyncio
    async def test_initiate_claim_stores_structured_subject_intent(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={
                "relationship": "self",
                "evidence": "My staff page lists this work.",
                "requested_changes": "Use my current organization and remove an old title.",
                "preferred_contact_channel": "form",
                "private_note": "Do not publish my direct email.",
            },
        )

        assert resp.status_code == 201, resp.text
        evidence = resp.json()["evidence"]
        assert evidence == {
            "relationship": "self",
            "evidence": "My staff page lists this work.",
            "requested_changes": "Use my current organization and remove an old title.",
            "preferred_contact_channel": "form",
            "private_note": "Do not publish my direct email.",
        }

    @pytest.mark.asyncio
    async def test_verify_email_marks_claim_and_entry_verified(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 201
        # Pull the token directly from the DB (the API doesn't return it).
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        verify = await test_client.post("/api/profiles/claims/verify-email", json={"token": token})
        assert verify.status_code == 200, verify.text
        body = verify.json()
        assert body["status"] == "verified"

        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.claim_status == "verified"
        assert entry.claim_verified_at is not None
        cursor = await test_db.execute(
            """
            SELECT proof_type, proof_status, proof_summary, proof_metadata_json
            FROM profile_claim_proofs
            WHERE claim_id = ?
            """,
            (body["id"],),
        )
        proof = await cursor.fetchone()
        assert proof is not None
        assert proof[0] == "email_domain"
        assert proof[1] == "verified"
        assert "atlas.rebuildingus.org" in proof[2]
        metadata = json.loads(proof[3])
        assert metadata["user_email_domain"] == "atlas.rebuildingus.org"

    @pytest.mark.asyncio
    async def test_verify_email_rejects_unknown_token(self, test_client: object) -> None:
        resp = await test_client.post(
            "/api/profiles/claims/verify-email", json={"token": "no-such-token"}
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_list_my_claims_returns_user_records(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})

        resp = await test_client.get("/api/profiles/claims/me")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["entry_slug"] == slug

    @pytest.mark.asyncio
    async def test_org_claim_with_matching_atproto_identity_verifies_profile(
        self,
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
            did="did:plc:mississippirising",
            handle="mississippirising.org",
            pds_url="https://bsky.social",
        )
        await test_db.commit()
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"atproto_identity_id": identity.id},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "verified"
        assert body["linked_atproto_handle"] == "mississippirising.org"
        assert body["proofs"][0]["proof_type"] == "atproto"
        assert body["proofs"][0]["proof_status"] == "verified"

        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.claim_status == "verified"
        assert entry.claim_verified_at is not None

        detail = await test_client.get(f"/api/entities/{claimable_org}")
        assert detail.status_code == 200
        assert detail.json()["claim"]["linked_atproto_handle"] == "mississippirising.org"
        assert detail.json()["claim"]["linked_atproto_did"] == "did:plc:mississippirising"

    @pytest.mark.asyncio
    async def test_workspace_admin_with_verified_matching_sso_domain_verifies_org_claim(
        self,
        test_client: object,
        test_db: object,
        test_settings: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        test_settings.deploy_mode = "hosted"
        test_settings.auth_internal_secret = "test-secret"
        test_settings.auth_membership_verification_url = "https://app.example"

        async def fake_verify_org_membership(
            user_id: str,
            org_id: str,
            _settings: object,
        ) -> MembershipResult:
            assert user_id == "user_1"
            assert org_id == "workspace_1"
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

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            headers={
                "X-Atlas-Internal-Secret": "test-secret",
                "X-Atlas-Actor-Id": "user_1",
                "X-Atlas-Actor-Email": "operator@example.net",
                "X-Atlas-Organization-Id": "workspace_1",
            },
            json={"use_active_workspace": True},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "verified"
        assert body["proofs"][0]["proof_type"] == "sso_admin"
        assert body["proofs"][0]["proof_status"] == "verified"

    @pytest.mark.asyncio
    async def test_workspace_member_or_mismatched_domain_does_not_auto_verify_org_claim(
        self,
        test_client: object,
        test_db: object,
        test_settings: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        test_settings.deploy_mode = "hosted"
        test_settings.auth_internal_secret = "test-secret"
        test_settings.auth_membership_verification_url = "https://app.example"

        async def fake_verify_org_membership(
            _user_id: str,
            _org_id: str,
            _settings: object,
        ) -> MembershipResult:
            return MembershipResult(
                role="member",
                slug="untrusted",
                name="Untrusted",
                workspace_type="team",
                active_products=["atlas_team"],
                workspace_domain="mississippirising.org",
                verified_sso_domains=["different.org"],
            )

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profile_claim_helpers.verify_org_membership",
            fake_verify_org_membership,
        )
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            headers={
                "X-Atlas-Internal-Secret": "test-secret",
                "X-Atlas-Actor-Id": "user_1",
                "X-Atlas-Actor-Email": "operator@example.net",
                "X-Atlas-Organization-Id": "workspace_1",
            },
            json={
                "evidence": "I manage the workspace but still need review.",
                "use_active_workspace": True,
            },
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "pending"
        assert body["proofs"][0]["proof_type"] == "sso_admin"
        assert body["proofs"][0]["proof_status"] == "pending"

    @pytest.mark.asyncio
    async def test_initiate_claim_reports_profile_deleted_before_response(
        self,
        test_client: object,
        test_db: object,
        claimable_person: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug

        async def missing_entry(*_args: object, **_kwargs: object) -> None:
            return None

        monkeypatch.setattr(profile_claims_api.EntryCRUD, "get_by_id", missing_entry)

        response = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "This is my profile."},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Profile not found"

    @pytest.mark.asyncio
    async def test_email_claim_verify_reports_profile_deleted_before_response(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        claim_resp = await test_client.post(f"/api/profiles/{entry.slug}/claim", json={})
        assert claim_resp.status_code == 201
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        calls = 0

        async def entry_then_missing(*_args: object, **_kwargs: object) -> object | None:
            nonlocal calls
            calls += 1
            return entry if calls == 1 else None

        monkeypatch.setattr(profile_claims_api.EntryCRUD, "get_by_id", entry_then_missing)

        response = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Profile not found"

    @pytest.mark.asyncio
    async def test_domain_dns_claim_verifies_after_txt_record_seen(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        resolver_calls: list[str] = []

        class FakeClaimDnsResolver:
            async def resolve_txt_records(self, domain: str) -> set[str]:
                resolver_calls.append(domain)
                return {challenge}

        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        claim_resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={
                "dns_domain": "mississippirising.org",
                "evidence": "I publish the official website.",
            },
        )
        assert claim_resp.status_code == 201, claim_resp.text
        claim = claim_resp.json()
        proof = claim["proofs"][0]
        assert proof["proof_type"] == "domain_dns"
        assert proof["proof_status"] == "pending"
        assert (
            proof["proof_summary"]
            == "Waiting for DNS record at _atlas-claim.mississippirising.org."
        )
        challenge = proof["metadata"]["challenge_value"]
        monkeypatch.setattr(
            "atlas.domains.catalog.api.profile_claims.DnsProfileClaimTxtResolver",
            FakeClaimDnsResolver,
        )

        verify_resp = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim['id']}/verify-domain",
            json={},
        )

        assert verify_resp.status_code == 200, verify_resp.text
        verified = verify_resp.json()
        assert verified["status"] == "verified"
        assert verified["proofs"][0]["proof_type"] == "domain_dns"
        assert verified["proofs"][0]["proof_status"] == "verified"
        assert resolver_calls == ["_atlas-claim.mississippirising.org"]

    @pytest.mark.asyncio
    async def test_domain_dns_claim_verify_reports_profile_deleted_before_response(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class FakeClaimDnsResolver:
            async def resolve_txt_records(self, _domain: str) -> set[str]:
                return {challenge}

        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        claim_resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={
                "dns_domain": "mississippirising.org",
                "evidence": "I publish the official website.",
            },
        )
        assert claim_resp.status_code == 201, claim_resp.text
        claim = claim_resp.json()
        challenge = claim["proofs"][0]["metadata"]["challenge_value"]
        monkeypatch.setattr(
            "atlas.domains.catalog.api.profile_claims.DnsProfileClaimTxtResolver",
            FakeClaimDnsResolver,
        )

        async def missing_entry(*_args: object, **_kwargs: object) -> None:
            return None

        monkeypatch.setattr(profile_claims_api.EntryCRUD, "get_by_id", missing_entry)

        response = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim['id']}/verify-domain",
            json={},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Profile not found"

    @pytest.mark.asyncio
    async def test_pending_claim_owned_by_another_user_blocks_new_claim(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        claim_resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "I manage this profile."},
        )
        assert claim_resp.status_code == 201
        await test_db.execute(
            "UPDATE profile_claims SET user_id = ? WHERE id = ?", ("other", claim_resp.json()["id"])
        )
        await test_db.commit()

        response = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "I manage this profile too."},
        )

        assert response.status_code == 409
        assert (
            response.json()["detail"]
            == "This profile already has a verification waiting for review."
        )

    @pytest.mark.asyncio
    async def test_pending_claim_owned_by_same_user_returns_existing_claim(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        claim_resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "I manage this profile."},
        )
        assert claim_resp.status_code == 201

        response = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "Still me."},
        )

        assert response.status_code == 201
        assert response.json()["id"] == claim_resp.json()["id"]

    @pytest.mark.asyncio
    async def test_stale_pending_profile_without_active_claim_can_start_new_claim(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        await EntryCRUD.update(
            test_db,
            claimable_org,
            claim_status="pending",
            claimed_by_user_id="missing-claim-user",
        )
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

        response = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "I manage this profile."},
        )

        assert response.status_code == 201
        assert response.json()["status"] == "pending"

    @pytest.mark.asyncio
    async def test_verified_claim_owned_by_another_user_blocks_new_claim(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        await EntryCRUD.update(
            test_db,
            claimable_org,
            claim_status="verified",
            claimed_by_user_id="other",
            claim_verified_at="2026-07-10T12:00:00Z",
        )
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

        response = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "I manage this profile."},
        )

        assert response.status_code == 409
        assert response.json()["detail"] == "This profile is already verified by another user."

    @pytest.mark.asyncio
    async def test_domain_dns_claim_verify_rejects_invalid_claim_states(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        claim_resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"dns_domain": "mississippirising.org", "evidence": "I publish the website."},
        )
        assert claim_resp.status_code == 201
        claim_id = claim_resp.json()["id"]

        missing_profile = await test_client.post(
            f"/api/profiles/missing-profile/claims/{claim_id}/verify-domain",
            json={},
        )
        assert missing_profile.status_code == 404
        assert missing_profile.json()["detail"] == "Profile not found"

        missing_claim = await test_client.post(
            f"/api/profiles/{slug}/claims/missing-claim/verify-domain",
            json={},
        )
        assert missing_claim.status_code == 404
        assert missing_claim.json()["detail"] == "Claim not found"

        await test_db.execute(
            "UPDATE profile_claims SET user_id = ? WHERE id = ?", ("other", claim_id)
        )
        await test_db.commit()
        wrong_user = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim_id}/verify-domain",
            json={},
        )
        assert wrong_user.status_code == 403
        assert wrong_user.json()["detail"] == "Claim belongs to another user."

        await test_db.execute(
            "UPDATE profile_claims SET user_id = ?, status = ? WHERE id = ?",
            ("local-operator", "verified", claim_id),
        )
        await test_db.commit()
        not_pending = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim_id}/verify-domain",
            json={},
        )
        assert not_pending.status_code == 409
        assert not_pending.json()["detail"] == "Claim is verified."

    @pytest.mark.asyncio
    async def test_domain_dns_claim_verify_rejects_missing_or_incomplete_dns_proof(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        claim_resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"dns_domain": "mississippirising.org", "evidence": "I publish the website."},
        )
        assert claim_resp.status_code == 201
        claim_id = claim_resp.json()["id"]

        await test_db.execute("DELETE FROM profile_claim_proofs WHERE claim_id = ?", (claim_id,))
        await test_db.commit()
        missing_proof = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim_id}/verify-domain",
            json={},
        )
        assert missing_proof.status_code == 404
        assert missing_proof.json()["detail"] == "DNS record request not found."

        proof = await ProfileClaimCRUD.record_proof(
            test_db,
            claim_id=claim_id,
            proof_type="domain_dns",
            proof_status="pending",
            proof_summary="Waiting for DNS record.",
            proof_metadata={"challenge_value": "atlas-claim-token"},
        )
        incomplete = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim_id}/verify-domain",
            json={},
        )
        assert incomplete.status_code == 409
        assert incomplete.json()["detail"] == "DNS TXT record is incomplete."

        await test_db.execute(
            "UPDATE profile_claim_proofs SET proof_metadata_json = ? WHERE id = ?",
            (
                json.dumps(
                    {
                        "challenge_value": "atlas-claim-token",
                        "challenge_host": "_atlas-claim.mississippirising.org",
                    }
                ),
                proof.id,
            ),
        )
        await test_db.commit()
        not_found = await test_client.post(
            f"/api/profiles/{slug}/claims/{claim_id}/verify-domain",
            json={},
        )
        assert not_found.status_code == 409
        assert not_found.json()["detail"] == "DNS TXT record not found."


@pytest.mark.asyncio
async def test_profile_claim_helpers_reject_unusable_dns_or_workspace_proofs(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    claim = await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_org,
        user_id="local-operator",
        user_email="operator@atlas.test",
        tier=2,
        evidence={"evidence": "I manage this organization."},
    )

    with pytest.raises(HTTPException) as bad_domain:
        await apply_dns_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            domain="other.example",
        )
    assert bad_domain.value.status_code == 400
    assert bad_domain.value.detail == "Domain is not listed on this profile."

    actor_without_workspace = SimpleNamespace(user_id="local-operator", org_id=None)
    with pytest.raises(HTTPException) as missing_workspace:
        await apply_workspace_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            actor=actor_without_workspace,
            settings=SimpleNamespace(),
        )
    assert missing_workspace.value.status_code == 400
    assert missing_workspace.value.detail == "Active workspace is required."

    actor_with_workspace = SimpleNamespace(user_id="local-operator", org_id="org_missing")

    async def no_membership(_user_id: str, _org_id: str, _settings: object) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_helpers.verify_org_membership",
        no_membership,
    )
    with pytest.raises(HTTPException) as no_workspace_proof_membership:
        await apply_workspace_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            actor=actor_with_workspace,
            settings=SimpleNamespace(),
        )
    assert no_workspace_proof_membership.value.status_code == 403
    assert (
        no_workspace_proof_membership.value.detail == "Active workspace membership was not found."
    )

    with pytest.raises(HTTPException) as missing_backing_workspace:
        await validate_workspace_claim_backing(
            actor_without_workspace,
            SimpleNamespace(),
        )
    assert missing_backing_workspace.value.status_code == 400
    assert missing_backing_workspace.value.detail == "Active workspace is required."

    with pytest.raises(HTTPException) as no_workspace_membership:
        await validate_workspace_claim_backing(
            actor_with_workspace,
            SimpleNamespace(),
        )
    assert no_workspace_membership.value.status_code == 403
    assert no_workspace_membership.value.detail == "Active workspace membership was not found."


@pytest.mark.asyncio
async def test_verify_claim_with_entry_raises_when_claim_disappears(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def missing_verified_claim(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(ProfileClaimCRUD, "mark_verified", missing_verified_claim)

    with pytest.raises(HTTPException) as exc_info:
        await verify_claim_with_entry(
            test_db,
            "claim_missing",
            proof_type="manual_review",
            proof_summary="Reviewer confirmed this representative.",
            proof_metadata={"reviewer_id": "operator"},
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Failed to verify claim."
