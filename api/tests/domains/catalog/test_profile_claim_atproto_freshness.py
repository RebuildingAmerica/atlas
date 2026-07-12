"""ATProto freshness checks for profile verification proofs."""

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.models import EntryCRUD


@pytest.mark.asyncio
async def test_matching_atproto_identity_is_rechecked_before_profile_verifies(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="local-operator",
        did="did:plc:stale",
        handle="mississippirising.org",
        pds_url="https://bsky.social",
    )
    await test_db.commit()
    calls: list[tuple[str, str]] = []

    async def fake_verify_current_identity(handle: str, did: str) -> bool:
        calls.append((handle, did))
        return False

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_current_atproto_identity",
        fake_verify_current_identity,
        raising=False,
    )
    slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug

    response = await test_client.post(
        f"/api/profiles/{slug}/claim",
        json={"atproto_identity_id": identity.id},
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert calls == [("mississippirising.org", "did:plc:stale")]
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    assert entry.claim_status == "unclaimed"
