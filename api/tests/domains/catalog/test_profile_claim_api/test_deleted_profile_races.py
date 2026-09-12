"""A profile deleted while its claim is in flight."""

# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.domains.catalog.api import profile_claims as profile_claims_api
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

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
