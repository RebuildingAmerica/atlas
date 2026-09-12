"""Tests for ATProto handle/DID freshness checks."""

from __future__ import annotations

import pytest

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api.atproto_identities import resolve_atproto_sign_in
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_controls import (
    AtprotoIdentityControlConflictError,
    AtprotoIdentityControlCRUD,
)
from atlas.domains.catalog.models.entry_model import _hydrate_atproto_identities
from atlas.domains.catalog.models.profile_atproto_links import (
    ProfileAtprotoLinkConflictError,
    ProfileAtprotoLinkCRUD,
)
from atlas.domains.catalog.schemas.public import AtprotoIdentitySignInResolveRequest


@pytest.mark.asyncio
async def test_global_identity_control_lifecycle_is_independent_from_identity(
    test_db: object,
) -> None:
    identity, control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:person",
        handle="person.example",
        pds_url="https://pds.example",
    )

    assert identity.did == "did:plc:person"
    assert control.status == "active"
    assert await AtprotoIdentityControlCRUD.disconnect(
        test_db, user_id="user_1", identity_id=identity.id
    )
    assert await AtprotoIdentityCRUD.get_by_id(test_db, identity.id) == identity

    refreshed, reconnected = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:person",
        handle="renamed.example",
        pds_url="https://new-pds.example",
    )
    assert refreshed.id == identity.id
    assert refreshed.current_handle == "renamed.example"
    assert reconnected.id == control.id
    assert reconnected.status == "active"


@pytest.mark.asyncio
async def test_internal_sign_in_resolution_returns_only_the_active_controller(
    test_db: object,
) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:sign-in",
        handle="sign-in.example",
    )
    resolved = await resolve_atproto_sign_in(
        AtprotoIdentitySignInResolveRequest(did=identity.did),
        actor=AuthenticatedActor(
            user_id="atlas-app",
            email="app@atlas.test",
            auth_type="internal",
        ),
        db=test_db,
    )

    assert resolved.user_id == "user_1"


@pytest.mark.asyncio
async def test_second_user_control_conflict_does_not_replace_active_controller(
    test_db: object,
) -> None:
    identity, first = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:controlled",
        handle="person.example",
    )

    with pytest.raises(AtprotoIdentityControlConflictError):
        await AtprotoIdentityControlCRUD.connect(
            test_db,
            user_id="user_2",
            did=identity.did,
            handle=identity.current_handle,
        )
    with pytest.raises(AtprotoIdentityControlConflictError):
        await AtprotoIdentityControlCRUD.connect(
            test_db,
            user_id="user_2",
            did=identity.did,
            handle=identity.current_handle,
        )

    active = await AtprotoIdentityControlCRUD.get_active_for_identity(test_db, identity.id)
    competing = await AtprotoIdentityControlCRUD.get_for_user_and_identity(
        test_db, user_id="user_2", identity_id=identity.id
    )
    assert active == first
    assert competing is not None
    assert competing.status == "conflict"


@pytest.mark.asyncio
async def test_profile_link_requires_explicit_replacement_and_retains_history(
    test_db: object,
    claimable_org: str,
) -> None:
    first = await AtprotoIdentityCRUD.upsert(test_db, did="did:plc:first", handle="first.example")
    second = await AtprotoIdentityCRUD.upsert(
        test_db, did="did:plc:second", handle="second.example"
    )
    original = await ProfileAtprotoLinkCRUD.attach(
        test_db, entry_id=claimable_org, identity_id=first.id
    )

    with pytest.raises(ProfileAtprotoLinkConflictError):
        await ProfileAtprotoLinkCRUD.attach(test_db, entry_id=claimable_org, identity_id=second.id)

    replacement = await ProfileAtprotoLinkCRUD.attach(
        test_db, entry_id=claimable_org, identity_id=second.id, replace=True
    )
    removed = await ProfileAtprotoLinkCRUD.get_by_id(test_db, original.id)
    assert removed is not None
    assert removed.status == "removed"
    assert replacement.identity_id == second.id
    assert replacement.status == "verified"

    refreshed = await ProfileAtprotoLinkCRUD.attach(
        test_db, entry_id=claimable_org, identity_id=second.id
    )
    assert refreshed.id == replacement.id


@pytest.mark.asyncio
async def test_empty_entry_hydration_is_a_noop(test_db: object) -> None:
    assert await _hydrate_atproto_identities(test_db, []) == []


@pytest.mark.asyncio
async def test_atproto_identity_crud_refreshes_existing_identity(test_db: object) -> None:
    created = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:existing",
        handle="old.example",
        pds_url=None,
    )

    refreshed = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:existing",
        handle="new.example",
        pds_url="https://pds.example",
    )

    assert refreshed.id == created.id
    assert refreshed.current_handle == "new.example"
    assert refreshed.pds_url == "https://pds.example"
    assert await AtprotoIdentityCRUD.get_by_id(test_db, "missing") is None
    assert await AtprotoIdentityCRUD.get_by_did(test_db, "did:plc:missing") is None


@pytest.mark.asyncio
async def test_atproto_identity_crud_raises_when_refresh_disappears(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:vanishing",
        handle="old.example",
    )

    async def fake_get_by_did(*_args: object, **_kwargs: object) -> object:
        return existing

    async def fake_get_by_id(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_did", fake_get_by_did)
    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_id", fake_get_by_id)

    with pytest.raises(RuntimeError, match="disappeared"):
        await AtprotoIdentityCRUD.upsert(
            test_db,
            did="did:plc:vanishing",
            handle="new.example",
        )


@pytest.mark.asyncio
async def test_control_connect_raises_when_created_row_disappears(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def missing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityControlCRUD, "get_by_id", missing)
    with pytest.raises(RuntimeError, match="control disappeared"):
        await AtprotoIdentityControlCRUD.connect(
            test_db,
            user_id="user_1",
            did="did:plc:missing-control",
            handle="missing-control.example",
        )


@pytest.mark.asyncio
async def test_profile_attach_raises_when_created_row_disappears(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db, did="did:plc:missing-link", handle="missing-link.example"
    )

    async def missing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(ProfileAtprotoLinkCRUD, "get_by_id", missing)
    with pytest.raises(RuntimeError, match="profile link disappeared"):
        await ProfileAtprotoLinkCRUD.attach(
            test_db, entry_id=claimable_org, identity_id=identity.id
        )
