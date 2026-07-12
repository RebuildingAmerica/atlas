"""Tests for subject profile management endpoints."""
# ruff: noqa: PLR2004

from __future__ import annotations

import pytest
from fastapi import status

from atlas.domains.catalog.models.atproto_identities import (
    AtprotoIdentityCRUD,
    AtprotoIdentityModel,
)
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.profile_atproto_links import ProfileAtprotoLinkCRUD
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.services.atproto_identity import AtprotoIdentityResolution
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


async def _controlled_identity(
    test_db: object,
    *,
    did: str,
    handle: str,
) -> AtprotoIdentityModel:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="local-operator",
        did=did,
        handle=handle,
        pds_url="https://pds.example",
    )
    await test_db.commit()
    return identity


@pytest.mark.asyncio
async def test_verified_steward_attaches_and_removes_identity_without_deleting_account(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="local-operator",
        claim_verified_at="2026-07-12T12:00:00Z",
    )
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    identity = await _controlled_identity(test_db, did="did:plc:org", handle="org.example")

    async def resolved(did: str) -> AtprotoIdentityResolution:
        return AtprotoIdentityResolution(
            did=did,
            handle="org.example",
            pds_url="https://pds.example",
        )

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profiles.resolve_current_atproto_identity",
        resolved,
    )
    attached = await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": identity.id, "replace": False},
    )

    assert attached.status_code == status.HTTP_200_OK, attached.text
    assert attached.json()["current_handle"] == "org.example"
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.identity_id == identity.id

    removed = await test_client.delete(f"/api/profiles/{entry.slug}/atproto-identity")
    assert removed.status_code == status.HTTP_204_NO_CONTENT
    assert await AtprotoIdentityCRUD.get_by_id(test_db, identity.id) is not None
    assert (
        await AtprotoIdentityControlCRUD.get_active_for_user_and_identity(
            test_db, user_id="local-operator", identity_id=identity.id
        )
        is not None
    )


@pytest.mark.asyncio
async def test_profile_identity_replacement_must_be_explicit(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="local-operator",
    )
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    first = await _controlled_identity(test_db, did="did:plc:first", handle="first.example")
    second = await _controlled_identity(test_db, did="did:plc:second", handle="second.example")

    async def resolved(did: str) -> AtprotoIdentityResolution:
        handle = "first.example" if did.endswith("first") else "second.example"
        return AtprotoIdentityResolution(did=did, handle=handle, pds_url=None)

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profiles.resolve_current_atproto_identity",
        resolved,
    )
    await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": first.id},
    )
    conflict = await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": second.id},
    )
    assert conflict.status_code == status.HTTP_409_CONFLICT

    replaced = await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": second.id, "replace": True},
    )
    assert replaced.status_code == status.HTTP_200_OK
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.identity_id == second.id


@pytest.mark.asyncio
async def test_profile_identity_rejects_non_steward_and_disconnected_control(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    identity = await _controlled_identity(test_db, did="did:plc:org", handle="org.example")

    non_steward = await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": identity.id},
    )
    assert non_steward.status_code == status.HTTP_403_FORBIDDEN

    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="local-operator",
    )
    await AtprotoIdentityControlCRUD.disconnect(
        test_db, user_id="local-operator", identity_id=identity.id
    )
    await test_db.commit()

    async def should_not_resolve(_did: str) -> None:
        raise AssertionError

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profiles.resolve_current_atproto_identity",
        should_not_resolve,
    )
    disconnected = await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": identity.id},
    )
    assert disconnected.status_code == status.HTTP_409_CONFLICT


@pytest.mark.asyncio
async def test_profile_identity_handles_missing_profile_link_and_stale_resolution(
    test_client: object,
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing = await test_client.put(
        "/api/profiles/not-a-profile/atproto-identity",
        json={"atproto_identity_id": "missing"},
    )
    assert missing.status_code == status.HTTP_404_NOT_FOUND

    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="local-operator",
    )
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    identity = await _controlled_identity(
        test_db, did="did:plc:stale-profile", handle="stale-profile.example"
    )

    async def unresolved(_did: str) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profiles.resolve_current_atproto_identity",
        unresolved,
    )
    stale = await test_client.put(
        f"/api/profiles/{entry.slug}/atproto-identity",
        json={"atproto_identity_id": identity.id},
    )
    assert stale.status_code == status.HTTP_409_CONFLICT

    no_link = await test_client.delete(f"/api/profiles/{entry.slug}/atproto-identity")
    assert no_link.status_code == status.HTTP_404_NOT_FOUND
