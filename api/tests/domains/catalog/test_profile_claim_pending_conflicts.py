"""Tests for pending profile verification conflict handling."""

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


@pytest.mark.asyncio
async def test_pending_claim_request_returns_existing_for_same_user(
    test_client: object,
    test_db: object,
    claimable_person: str,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
    first = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "My staff page lists this profile."},
    )

    second = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "Trying again with the same account."},
    )

    assert second.status_code == status.HTTP_201_CREATED, second.text
    assert second.json()["id"] == first.json()["id"]


@pytest.mark.asyncio
async def test_pending_claim_request_rejects_when_another_user_is_waiting(
    test_client: object,
    test_db: object,
    claimable_person: str,
) -> None:
    await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_person,
        user_id="another-user",
        user_email="another@example.org",
        tier=2,
        evidence={"evidence": "Existing pending verification."},
    )
    await EntryCRUD.update(
        test_db,
        claimable_person,
        claim_status="pending",
        claimed_by_user_id="another-user",
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"evidence": "This is my profile."},
    )

    assert response.status_code == status.HTTP_409_CONFLICT
