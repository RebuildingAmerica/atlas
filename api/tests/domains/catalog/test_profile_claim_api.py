"""Tests for the public profile claim API flow."""
# ruff: noqa: PLR2004

from __future__ import annotations

import json

import pytest

from atlas.domains.access.membership import MembershipResult
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
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
        identity = await AtprotoIdentityCRUD.upsert(
            test_db,
            user_id="local-operator",
            did="did:plc:mississippirising",
            handle="mississippirising.org",
            pds_url="https://bsky.social",
        )
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
