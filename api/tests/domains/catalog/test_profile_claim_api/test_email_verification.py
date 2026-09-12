"""Verifying a claim by emailed token."""

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
