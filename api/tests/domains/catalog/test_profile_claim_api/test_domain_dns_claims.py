"""Proving a claim with a DNS TXT record."""

# ruff: noqa: PLR2004

from __future__ import annotations

import json

import pytest

from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

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
