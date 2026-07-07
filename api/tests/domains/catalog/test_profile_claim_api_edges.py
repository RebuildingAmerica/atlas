"""HTTP edge-case tests for profile claim, manage, and follow APIs."""
# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


class TestProfileClaimAPIEdgeCases:
    """HTTP-level edge cases for the profile claim/manage/follow endpoints."""

    @pytest.mark.asyncio
    async def test_initiate_claim_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.post("/api/profiles/nonexistent-slug-xyz/claim", json={})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_initiate_claim_returns_existing_for_same_user_when_already_verified(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """A re-claim by the same verified user should return their existing claim."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        # Initiate + verify once.
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )

        # A second initiation by the same actor should not 409 — it should
        # return the existing verified claim.
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "verified"

    @pytest.mark.asyncio
    async def test_initiate_claim_409_when_verified_by_another_user(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """A claim attempt on a profile verified by someone else should 409."""
        # Pre-seed a verified claim attached to a different user_id.
        await EntryCRUD.update(
            test_db,
            claimable_org,
            claim_status="verified",
            claimed_by_user_id="some-other-user",
        )
        await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="some-other-user",
            user_email="other@example.com",
            tier=1,
        )
        await ProfileClaimCRUD.mark_verified(
            test_db,
            (await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)).id,
        )

        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_verify_email_409_when_claim_not_pending(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """Verifying with a token whose claim is no longer pending should 409."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        # Manually transition the claim past pending without clearing the
        # token, so the API has something to look up but rejects the state.
        await test_db.execute(
            "UPDATE profile_claims SET status = 'rejected' WHERE id = ?",
            (claim.id,),
        )
        await test_db.commit()

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": token},
        )
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_verify_email_410_when_token_expired(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """An expired verification token should 410 and reject the claim."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        # Stomp the expiry into the past.
        await test_db.execute(
            "UPDATE profile_claims SET verification_token_expires_at = ? WHERE id = ?",
            ("2000-01-01T00:00:00+00:00", claim.id),
        )
        await test_db.commit()

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": token},
        )
        assert resp.status_code == 410

    @pytest.mark.asyncio
    async def test_verify_email_410_when_token_has_no_expiry_recorded(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """A claim missing an expiry timestamp should be treated as expired."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        await test_db.execute(
            "UPDATE profile_claims SET verification_token_expires_at = NULL WHERE id = ?",
            (claim.id,),
        )
        await test_db.commit()

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": token},
        )
        assert resp.status_code == 410

    @pytest.mark.asyncio
    async def test_verify_email_409_when_entry_no_longer_matches_email_domain(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """Email verification should fail if the profile no longer matches the claim domain."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None

        await EntryCRUD.update(test_db, claimable_org, email="info@different.example")

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )

        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_list_my_claims_skips_orphaned_entries(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """list_my_claims should silently drop claims whose entry has been deleted."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})

        async def fake_get_by_id(_db: object, _entry_id: str) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profiles.EntryCRUD.get_by_id",
            fake_get_by_id,
        )
        resp = await test_client.get("/api/profiles/claims/me")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_manage_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.patch(
            "/api/profiles/no-such-slug/manage",
            json={"custom_bio": "x"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_manage_clear_photo_drops_existing_photo(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """clear_photo=True should null out the photo column."""
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

        # Seed a photo, then clear it.
        await EntryCRUD.update(test_db, claimable_org, photo_url="https://example.com/old.jpg")
        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={"clear_photo": True},
        )
        assert resp.status_code == 200, resp.text
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.photo_url is None

    @pytest.mark.asyncio
    async def test_manage_clear_custom_bio_drops_existing_bio(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """clear_custom_bio=True should null out the bio column."""
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
        await EntryCRUD.update(test_db, claimable_org, custom_bio="hand-written")

        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={"clear_custom_bio": True},
        )
        assert resp.status_code == 200, resp.text
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.custom_bio is None

    @pytest.mark.asyncio
    async def test_manage_no_fields_returns_updated_false(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """An empty manage payload should report no updates."""
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

        resp = await test_client.patch(f"/api/profiles/{slug}/manage", json={})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"updated": False, "fields": []}

    @pytest.mark.asyncio
    async def test_follow_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.post("/api/profiles/no-slug/follow")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_unfollow_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.delete("/api/profiles/no-slug/follow")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_follow_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.get("/api/profiles/no-slug/follow")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_claim_decisions_tolerate_missing_refetch(
        self,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Decision writes should not crash if a follow-up claim refetch disappears."""
        claims = [
            await ProfileClaimCRUD.create(
                test_db,
                entry_id=claimable_org,
                user_id=f"user-{status}",
                user_email=f"{status}@example.com",
                tier=2,
            )
            for status in ("verified", "rejected", "revoked")
        ]

        async def missing_claim(_conn: object, _claim_id: str) -> object:
            return None

        monkeypatch.setattr(ProfileClaimCRUD, "get_by_id", missing_claim)

        assert await ProfileClaimCRUD.mark_verified(test_db, claims[0].id) is None
        assert (
            await ProfileClaimCRUD.mark_rejected(test_db, claims[1].id, "not enough proof") is None
        )
        assert await ProfileClaimCRUD.revoke(test_db, claims[2].id, "claim withdrawn") is None
