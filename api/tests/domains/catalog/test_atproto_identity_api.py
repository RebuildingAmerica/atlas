"""Tests for the account ATProto identity lifecycle API."""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Response, status

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api.atproto_identities import (
    _verify_linked_atproto_identity,
    disconnect_atproto_identity,
    link_atproto_identity,
    list_atproto_identities,
    refresh_atproto_identity,
)
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.profile_atproto_links import ProfileAtprotoLinkCRUD
from atlas.domains.catalog.schemas.public import AtprotoIdentityLinkRequest, AtprotoIdentityResponse
from atlas.domains.catalog.services.atproto_identity import (
    AtprotoIdentityResolution,
    e2e_harness_identity_matches,
)


def _actor(user_id: str = "user_1", *, auth_type: str = "internal") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id=user_id,
        email=f"{user_id}@example.org",
        auth_type=auth_type,
    )


async def _connect(
    test_db: object, monkeypatch: pytest.MonkeyPatch, *, user_id: str = "user_1"
) -> tuple[AtprotoIdentityResponse, Response]:
    async def verified(_handle: str, _did: str) -> bool:
        return True

    monkeypatch.setattr(
        "atlas.domains.catalog.api.atproto_identities.verify_linked_atproto_identity",
        verified,
    )
    response = Response()
    body = await link_atproto_identity(
        AtprotoIdentityLinkRequest(
            did="did:plc:person",
            current_handle="person.example",
            pds_url="https://pds.example",
        ),
        response,
        actor=_actor(user_id),
        db=test_db,
    )
    return body, response


@pytest.mark.asyncio
async def test_identity_lifecycle_lists_without_user_metadata_and_no_store(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    linked, link_response = await _connect(test_db, monkeypatch)

    list_response = Response()
    listed = await list_atproto_identities(list_response, actor=_actor(), db=test_db)

    assert linked.control_status == "active"
    assert linked.current_handle == "person.example"
    assert not hasattr(linked, "user_id")
    assert listed == [linked]
    assert link_response.headers["cache-control"] == "no-store"
    assert list_response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_identity_lifecycle_reconnects_same_user_and_rejects_competing_user(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    linked, _ = await _connect(test_db, monkeypatch)
    reconnected, _ = await _connect(test_db, monkeypatch)
    assert reconnected.id == linked.id

    with pytest.raises(HTTPException) as conflict:
        await _connect(test_db, monkeypatch, user_id="user_2")
    assert conflict.value.status_code == status.HTTP_409_CONFLICT
    assert conflict.value.detail == (
        "ATProto identity is already connected to another Atlas account."
    )
    competing = await AtprotoIdentityControlCRUD.get_for_user_and_identity(
        test_db, user_id="user_2", identity_id=linked.id
    )
    assert competing is not None
    assert competing.status == "conflict"


@pytest.mark.asyncio
async def test_refresh_updates_current_handle_and_marks_failures_for_attention(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    linked, _ = await _connect(test_db, monkeypatch)

    async def resolved(_did: str) -> AtprotoIdentityResolution:
        return AtprotoIdentityResolution(
            did="did:plc:person",
            handle="renamed.example",
            pds_url="https://new-pds.example",
        )

    monkeypatch.setattr(
        "atlas.domains.catalog.api.atproto_identities.resolve_current_atproto_identity",
        resolved,
    )
    refreshed = await refresh_atproto_identity(linked.id, Response(), actor=_actor(), db=test_db)
    assert refreshed.current_handle == "renamed.example"
    assert refreshed.resolution_status == "verified"

    async def unresolved(_did: str) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.catalog.api.atproto_identities.resolve_current_atproto_identity",
        unresolved,
    )
    attention = await refresh_atproto_identity(linked.id, Response(), actor=_actor(), db=test_db)
    assert attention.resolution_status == "needs_attention"
    assert attention.last_resolution_error is not None


@pytest.mark.asyncio
async def test_disconnect_retains_identity_and_linked_profile(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
    claimable_org: str,
) -> None:
    linked, _ = await _connect(test_db, monkeypatch)
    await ProfileAtprotoLinkCRUD.attach(test_db, entry_id=claimable_org, identity_id=linked.id)
    before = await list_atproto_identities(Response(), actor=_actor(), db=test_db)
    assert before[0].profiles[0].id == claimable_org

    response = Response()
    await disconnect_atproto_identity(linked.id, response, actor=_actor(), db=test_db)

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert await AtprotoIdentityCRUD.get_by_id(test_db, linked.id) is not None
    assert await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org) is not None
    assert await list_atproto_identities(Response(), actor=_actor(), db=test_db) == []


@pytest.mark.asyncio
async def test_identity_actions_hide_other_users_identity(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    linked, _ = await _connect(test_db, monkeypatch)

    with pytest.raises(HTTPException) as refresh_error:
        await refresh_atproto_identity(linked.id, Response(), actor=_actor("user_2"), db=test_db)
    assert refresh_error.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as disconnect_error:
        await disconnect_atproto_identity(linked.id, Response(), actor=_actor("user_2"), db=test_db)
    assert disconnect_error.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_identity_api_rejects_external_api_actor(test_db: object) -> None:
    with pytest.raises(HTTPException) as error:
        await list_atproto_identities(Response(), actor=_actor(auth_type="oauth_jwt"), db=test_db)
    assert error.value.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.asyncio
async def test_link_rejects_unverified_oauth_result(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unverified(_handle: str, _did: str) -> bool:
        return False

    monkeypatch.setattr(
        "atlas.domains.catalog.api.atproto_identities.verify_linked_atproto_identity",
        unverified,
    )
    with pytest.raises(HTTPException) as error:
        await link_atproto_identity(
            AtprotoIdentityLinkRequest(
                did="did:plc:stale",
                current_handle="stale.example",
            ),
            Response(),
            actor=_actor(),
            db=test_db,
        )
    assert error.value.status_code == status.HTTP_409_CONFLICT
    assert await AtprotoIdentityCRUD.get_by_did(test_db, "did:plc:stale") is None


@pytest.mark.asyncio
async def test_local_client_uses_account_identity_route(test_client: object) -> None:
    response = await test_client.get("/api/atproto/identities")

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == []
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_list_skips_a_control_whose_identity_was_removed(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def controls(_db: object, _user_id: str) -> list[object]:
        return [type("Control", (), {"identity_id": "missing"})()]

    async def missing(_db: object, _identity_id: str) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityControlCRUD, "list_for_user", controls)
    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_id", missing)
    assert await list_atproto_identities(Response(), actor=_actor(), db=test_db) == []


def test_e2e_harness_match_is_explicit_and_normalized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", raising=False)
    assert not e2e_harness_identity_matches("Person.Example", "did:web:person.example")
    monkeypatch.setenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1")
    assert e2e_harness_identity_matches(" @Person.Example ", "did:web:person.example")


@pytest.mark.asyncio
async def test_e2e_harness_verification_short_circuits_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1")
    assert await _verify_linked_atproto_identity("Person.Example", "did:web:person.example")


@pytest.mark.asyncio
async def test_refresh_raises_if_identity_disappears_after_update(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    linked, _ = await _connect(test_db, monkeypatch)

    async def resolved(_did: str) -> AtprotoIdentityResolution:
        return AtprotoIdentityResolution(
            did="did:plc:person", handle="person.example", pds_url=None
        )

    original_get = AtprotoIdentityCRUD.get_by_id
    calls = 0

    async def disappears(conn: object, identity_id: str) -> object | None:
        nonlocal calls
        calls += 1
        if calls <= 2:
            return await original_get(conn, identity_id)
        return None

    monkeypatch.setattr(
        "atlas.domains.catalog.api.atproto_identities.resolve_current_atproto_identity",
        resolved,
    )
    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_id", disappears)
    with pytest.raises(HTTPException) as error:
        await refresh_atproto_identity(linked.id, Response(), actor=_actor(), db=test_db)
    assert error.value.status_code == status.HTTP_404_NOT_FOUND
