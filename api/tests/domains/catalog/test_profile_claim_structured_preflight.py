"""Preflight tests for profile verification proof requests."""

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD


async def _assert_no_claim_side_effect(
    test_db: object,
    entry_id: str,
) -> None:
    assert await ProfileClaimCRUD.get_active_for_entry(test_db, entry_id) is None
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry.claim_status == "unclaimed"


@pytest.mark.asyncio
async def test_invalid_dns_domain_does_not_create_profile_claim(
    test_client: object,
    test_db: object,
    claimable_org: str,
) -> None:
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={
            "dns_domain": "different.org",
            "evidence": "I publish another website.",
        },
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == "Domain is not listed on this profile."
    await _assert_no_claim_side_effect(test_db, claimable_org)


@pytest.mark.asyncio
async def test_missing_active_workspace_does_not_create_profile_claim(
    test_client: object,
    test_db: object,
    test_settings: object,
    claimable_org: str,
) -> None:
    test_settings.deploy_mode = "hosted"
    test_settings.auth_internal_secret = "test-secret"
    test_settings.auth_membership_verification_url = "https://app.example"
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        headers={
            "X-Atlas-Internal-Secret": "test-secret",
            "X-Atlas-Actor-Id": "user_1",
            "X-Atlas-Actor-Email": "operator@example.net",
        },
        json={
            "evidence": "I manage the organization workspace.",
            "use_active_workspace": True,
        },
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == "Active workspace is required."
    await _assert_no_claim_side_effect(test_db, claimable_org)


@pytest.mark.asyncio
async def test_unknown_active_workspace_membership_does_not_create_profile_claim(
    test_client: object,
    test_db: object,
    test_settings: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_settings.deploy_mode = "hosted"
    test_settings.auth_internal_secret = "test-secret"
    test_settings.auth_membership_verification_url = "https://app.example"

    async def missing_membership(
        _user_id: str,
        _org_id: str,
        _settings: object,
    ) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_helpers.verify_org_membership",
        missing_membership,
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        headers={
            "X-Atlas-Internal-Secret": "test-secret",
            "X-Atlas-Actor-Id": "user_1",
            "X-Atlas-Actor-Email": "operator@example.net",
            "X-Atlas-Organization-Id": "workspace_1",
        },
        json={
            "evidence": "I manage the organization workspace.",
            "use_active_workspace": True,
        },
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["detail"] == "Active workspace membership was not found."
    await _assert_no_claim_side_effect(test_db, claimable_org)
