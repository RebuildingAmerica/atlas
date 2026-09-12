"""Claims an organization's own identity proves without review."""

# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.domains.access.membership import MembershipResult
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

    @pytest.mark.asyncio
    async def test_org_claim_with_matching_atproto_identity_verifies_profile(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_linked_atproto_identity",
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
        test_settings.multi_user = True
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
        test_settings.multi_user = True
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
