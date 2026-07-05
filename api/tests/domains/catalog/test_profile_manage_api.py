"""Tests for subject profile management endpoints."""
# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


class TestProfileManageAPI:
    """Subject-management endpoint."""

    @pytest.mark.asyncio
    async def test_manage_requires_verified_claim(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={"custom_bio": "Updated bio"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_manage_persists_subject_fields(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        # Auto-verify by setting up a verified claim manually.
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email", json={"token": claim.verification_token}
        )

        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={
                "custom_bio": "I write my own story now.",
                "photo_url": "https://example.com/photo.jpg",
                "preferred_contact_channel": "email",
                "suppressed_source_ids": ["s1", "s2"],
            },
        )
        assert resp.status_code == 200, resp.text

        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.custom_bio == "I write my own story now."
        assert entry.photo_url == "https://example.com/photo.jpg"
        assert entry.preferred_contact_channel == "email"
        assert entry.suppressed_source_ids == ["s1", "s2"]
