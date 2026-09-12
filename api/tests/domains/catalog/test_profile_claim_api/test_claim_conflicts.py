"""A second claim meeting one that already exists."""

# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

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
