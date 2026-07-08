"""Defensive invariant tests for profile claim verification."""
# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.domains.catalog.api import profile_claims as profile_claim_api
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.services.profile_claims import ProfileClaimPolicy
from atlas.models import EntryCRUD


class TestVerifyClaimRefetchInvariants:
    """Direct unit tests for unreachable defensive checks in verify_claim."""

    @pytest.mark.asyncio
    async def test_verify_claim_500_when_mark_verified_returns_none(
        self,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """If mark_verified can't return the row, verify_claim must 500."""
        from atlas.domains.catalog.schemas.public import ProfileClaimVerifyRequest

        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        # Seed an email-verification record so we have a valid token to pass in.
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-x",
            user_email="user@atlas.rebuildingus.org",
            tier=1,
        )
        assert claim.verification_token is not None

        async def fake_mark_verified(_db: object, _claim_id: str, **_kwargs: object) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profile_claims.ProfileClaimCRUD.mark_verified",
            fake_mark_verified,
        )

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await profile_claim_api.verify_claim(
                ProfileClaimVerifyRequest(token=claim.verification_token),
                response=None,
                db=test_db,
                claim_policy=ProfileClaimPolicy(),
            )
        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_verify_claim_404_when_entry_lookup_returns_none(
        self,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """If the post-verification entry lookup fails, verify_claim must 404."""
        from atlas.domains.catalog.schemas.public import ProfileClaimVerifyRequest

        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-x",
            user_email="user@atlas.rebuildingus.org",
            tier=1,
        )
        assert claim.verification_token is not None

        async def fake_get_by_id(_db: object, _entry_id: str) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profile_claims.EntryCRUD.get_by_id",
            fake_get_by_id,
        )

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await profile_claim_api.verify_claim(
                ProfileClaimVerifyRequest(token=claim.verification_token),
                response=None,
                db=test_db,
                claim_policy=ProfileClaimPolicy(),
            )
        assert exc_info.value.status_code == 404
