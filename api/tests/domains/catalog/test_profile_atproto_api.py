"""Tests for ATProto profile-linking API routes."""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Response, status

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api.profile_atproto import link_atproto_identity
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.schemas.public import AtprotoIdentityLinkRequest


@pytest.mark.asyncio
async def test_link_atproto_identity_rejects_local_route_call(
    test_client: object,
) -> None:
    response = await test_client.post(
        "/api/profiles/atproto/identities",
        json={
            "did": "did:plc:mississippirising",
            "current_handle": "mississippirising.org",
            "pds_url": "https://bsky.social",
        },
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.asyncio
async def test_link_atproto_identity_persists_internal_oauth_result(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_verify_current_identity(handle: str, did: str) -> bool:
        calls.append((handle, did))
        return True

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_atproto.verify_current_atproto_identity",
        fake_verify_current_identity,
        raising=False,
    )

    body = await link_atproto_identity(
        AtprotoIdentityLinkRequest(
            did="did:plc:mississippirising",
            current_handle="mississippirising.org",
            pds_url="https://bsky.social",
        ),
        Response(),
        actor=AuthenticatedActor(
            user_id="user_1",
            email="user@example.org",
            auth_type="internal",
        ),
        db=test_db,
    )

    assert body.user_id == "user_1"
    assert body.did == "did:plc:mississippirising"
    assert body.current_handle == "mississippirising.org"
    assert calls == [("mississippirising.org", "did:plc:mississippirising")]
    stored = await AtprotoIdentityCRUD.get_by_id(test_db, body.id)
    assert stored is not None
    assert stored.handle_verified_at is not None


@pytest.mark.asyncio
async def test_link_atproto_identity_rejects_unverified_internal_oauth_result(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_verify_current_identity(handle: str, did: str) -> bool:
        assert handle == "mississippirising.org"
        assert did == "did:plc:stale"
        return False

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_atproto.verify_current_atproto_identity",
        fake_verify_current_identity,
        raising=False,
    )

    with pytest.raises(HTTPException) as exc_info:
        await link_atproto_identity(
            AtprotoIdentityLinkRequest(
                did="did:plc:stale",
                current_handle="mississippirising.org",
                pds_url="https://bsky.social",
            ),
            Response(),
            actor=AuthenticatedActor(
                user_id="user_1",
                email="user@example.org",
                auth_type="internal",
            ),
            db=test_db,
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    stored = await AtprotoIdentityCRUD.get_by_user_and_did(
        test_db,
        user_id="user_1",
        did="did:plc:stale",
    )
    assert stored is None


@pytest.mark.asyncio
async def test_link_atproto_identity_accepts_deterministic_e2e_harness_identity(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1")

    body = await link_atproto_identity(
        AtprotoIdentityLinkRequest(
            did="did:web:mississippirising.org",
            current_handle="mississippirising.org",
            pds_url="https://pds.atlas-e2e.test",
        ),
        Response(),
        actor=AuthenticatedActor(
            user_id="user_1",
            email="user@example.org",
            auth_type="internal",
        ),
        db=test_db,
    )

    assert body.did == "did:web:mississippirising.org"
    assert body.current_handle == "mississippirising.org"


@pytest.mark.asyncio
async def test_link_atproto_identity_rejects_mismatched_e2e_harness_identity(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1")

    with pytest.raises(HTTPException) as exc_info:
        await link_atproto_identity(
            AtprotoIdentityLinkRequest(
                did="did:web:other.example",
                current_handle="mississippirising.org",
                pds_url="https://pds.atlas-e2e.test",
            ),
            Response(),
            actor=AuthenticatedActor(
                user_id="user_1",
                email="user@example.org",
                auth_type="internal",
            ),
            db=test_db,
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT


@pytest.mark.asyncio
async def test_atproto_identity_crud_uses_initialized_schema(
    test_db: object,
) -> None:
    """ATProto identity reads and writes should rely on database initialization."""

    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        user_id="user_1",
        did="did:plc:initialized",
        handle="initialized.example",
        pds_url="https://bsky.social",
    )

    assert await AtprotoIdentityCRUD.get_by_id(test_db, identity.id) == identity


@pytest.mark.asyncio
async def test_link_atproto_identity_rejects_external_actor(test_db: object) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await link_atproto_identity(
            AtprotoIdentityLinkRequest(
                did="did:plc:unverified",
                current_handle="unverified.example",
                pds_url="https://bsky.social",
            ),
            Response(),
            actor=AuthenticatedActor(
                user_id="user_1",
                email="user@example.org",
                auth_type="oauth_jwt",
            ),
            db=test_db,
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
