"""Tests for organization ATProto identity administration APIs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api.organization_atproto_identities import (
    attach_organization_atproto_identity,
    detach_organization_atproto_identity,
    get_organization_atproto_identity,
    grant_organization_atproto_delegation,
    list_organization_atproto_delegations,
    revoke_organization_atproto_delegation,
)
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.schemas.public import (
    AtprotoIdentityDelegationRequest,
    OrganizationAtprotoIdentityAttachRequest,
)


def _admin(org_id: str = "org_1") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="owner_1",
        email="owner@example.org",
        auth_type="internal",
        org_id=org_id,
        org_role="owner",
    )


def _member(org_id: str = "org_1") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="member_1",
        email="member@example.org",
        auth_type="internal",
        org_id=org_id,
        org_role="member",
    )


@pytest.mark.asyncio
async def test_admin_attaches_controlled_identity_and_revokes_delegate(test_db: object) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="owner_1",
        did="did:plc:org-api",
        handle="org-api.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    attached = await attach_organization_atproto_identity(
        "org_1",
        OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    delegation = await grant_organization_atproto_delegation(
        "org_1",
        identity.id,
        AtprotoIdentityDelegationRequest(delegate_user_id="member_1"),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    revoked = await revoke_organization_atproto_delegation(
        "org_1",
        identity.id,
        "member_1",
        Response(),
        actor=_admin(),
        db=test_db,
    )

    assert attached.identity_id == identity.id
    assert delegation.delegate_user_id == "member_1"
    assert revoked.status == "revoked"


@pytest.mark.asyncio
async def test_active_delegate_can_remove_the_organization_identity(test_db: object) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="owner_1",
        did="did:plc:delegated-removal",
        handle="delegated-removal.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    await attach_organization_atproto_identity(
        "org_1",
        OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    await grant_organization_atproto_delegation(
        "org_1",
        identity.id,
        AtprotoIdentityDelegationRequest(delegate_user_id="member_1"),
        Response(),
        actor=_admin(),
        db=test_db,
    )

    removed = await detach_organization_atproto_identity(
        "org_1", identity.id, Response(), actor=_member(), db=test_db
    )

    assert removed.identity_id == identity.id
    assert removed.status == "removed"
    assert removed.detached_by == "member_1"


@pytest.mark.asyncio
async def test_revoked_delegate_cannot_remove_the_organization_identity(test_db: object) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="owner_1",
        did="did:plc:revoked-delegate-removal",
        handle="revoked-delegate-removal.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    await attach_organization_atproto_identity(
        "org_1",
        OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    await grant_organization_atproto_delegation(
        "org_1",
        identity.id,
        AtprotoIdentityDelegationRequest(delegate_user_id="member_1"),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    await revoke_organization_atproto_delegation(
        "org_1", identity.id, "member_1", Response(), actor=_admin(), db=test_db
    )

    with pytest.raises(HTTPException, match="not delegated") as denied:
        await detach_organization_atproto_identity(
            "org_1", identity.id, Response(), actor=_member(), db=test_db
        )

    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_organization_identity_rejects_wrong_workspace_or_uncontrolled_did(
    test_db: object,
) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="other_user",
        did="did:plc:someone-else",
        handle="someone-else.example",
    )

    with pytest.raises(HTTPException, match="controlled") as uncontrolled:
        await attach_organization_atproto_identity(
            "org_1",
            OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
            Response(),
            actor=_admin(),
            db=test_db,
        )
    assert uncontrolled.value.status_code == 403

    with pytest.raises(HTTPException, match="Organization context") as mismatch:
        await attach_organization_atproto_identity(
            "org_2",
            OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
            Response(),
            actor=_admin(),
            db=test_db,
        )
    assert mismatch.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_cannot_delegate_to_a_non_member(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="owner_1",
        did="did:plc:non-member-delegation",
        handle="non-member-delegation.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    await attach_organization_atproto_identity(
        "org_1",
        OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
        Response(),
        actor=_admin(),
        db=test_db,
    )

    async def missing_membership(*_args: object) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.catalog.api.organization_atproto_identities.get_settings",
        lambda: SimpleNamespace(auth_membership_verification_url="https://auth.example.test"),
    )
    monkeypatch.setattr(
        "atlas.domains.catalog.api.organization_atproto_identities.verify_org_membership",
        missing_membership,
    )

    with pytest.raises(HTTPException, match="workspace member") as rejected:
        await grant_organization_atproto_delegation(
            "org_1",
            identity.id,
            AtprotoIdentityDelegationRequest(delegate_user_id="outsider_1"),
            Response(),
            actor=_admin(),
            db=test_db,
        )
    assert rejected.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_reads_only_the_active_organization_identity_and_delegations(
    test_db: object,
) -> None:
    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="owner_1",
        did="did:plc:organization-authority",
        handle="organization-authority.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    await attach_organization_atproto_identity(
        "org_1",
        OrganizationAtprotoIdentityAttachRequest(identity_id=identity.id),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    await grant_organization_atproto_delegation(
        "org_1",
        identity.id,
        AtprotoIdentityDelegationRequest(delegate_user_id="active_member"),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    await grant_organization_atproto_delegation(
        "org_1",
        identity.id,
        AtprotoIdentityDelegationRequest(delegate_user_id="revoked_member"),
        Response(),
        actor=_admin(),
        db=test_db,
    )
    await revoke_organization_atproto_delegation(
        "org_1",
        identity.id,
        "revoked_member",
        Response(),
        actor=_admin(),
        db=test_db,
    )

    active_identity = await get_organization_atproto_identity(
        "org_1", Response(), actor=_admin(), db=test_db
    )
    active_delegations = await list_organization_atproto_delegations(
        "org_1", identity.id, Response(), actor=_admin(), db=test_db
    )

    assert active_identity is not None
    assert active_identity.identity_id == identity.id
    assert [delegation.delegate_user_id for delegation in active_delegations] == ["active_member"]
