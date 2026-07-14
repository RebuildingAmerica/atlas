"""Tests for organization ownership and delegated ATProto identity administration."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_delegations import (
    AtprotoIdentityDelegationCRUD,
    AtprotoIdentityDelegationInvariantError,
)
from atlas.domains.catalog.models.organization_atproto_identities import (
    OrganizationAtprotoIdentityCRUD,
    OrganizationAtprotoIdentityInvariantError,
)


@pytest.mark.asyncio
async def test_org_identity_delegation_grant_and_revocation_are_auditable(test_db: object) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:organization",
        handle="organization.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    attached = await OrganizationAtprotoIdentityCRUD.attach(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        attached_by="owner_1",
    )
    delegation = await AtprotoIdentityDelegationCRUD.grant(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        controller_user_id="owner_1",
        delegate_user_id="member_1",
        granted_by="owner_1",
    )

    assert attached.status == "active"
    assert delegation.status == "active"
    assert await AtprotoIdentityDelegationCRUD.is_active_delegate(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        delegate_user_id="member_1",
    )

    revoked = await AtprotoIdentityDelegationCRUD.revoke(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        delegate_user_id="member_1",
        revoked_by="owner_1",
    )

    assert revoked.status == "revoked"
    assert revoked.revoked_by == "owner_1"
    assert not await AtprotoIdentityDelegationCRUD.is_active_delegate(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        delegate_user_id="member_1",
    )


@pytest.mark.asyncio
async def test_regrant_reactivates_the_same_auditable_delegation(test_db: object) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:delegation-reactivation",
        handle="delegation-reactivation.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    first = await AtprotoIdentityDelegationCRUD.grant(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        controller_user_id="owner_1",
        delegate_user_id="member_1",
        granted_by="owner_1",
    )
    await AtprotoIdentityDelegationCRUD.revoke(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        delegate_user_id="member_1",
        revoked_by="owner_1",
    )

    regranted = await AtprotoIdentityDelegationCRUD.grant(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        controller_user_id="admin_1",
        delegate_user_id="member_1",
        granted_by="admin_1",
    )

    assert regranted.id == first.id
    assert regranted.status == "active"
    assert regranted.controller_user_id == "admin_1"
    assert regranted.revoked_by is None


@pytest.mark.asyncio
async def test_delegation_writes_fail_closed_when_the_audit_row_cannot_be_reloaded(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:delegation-write-invariant",
        handle="delegation-write-invariant.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )

    async def missing_row(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityDelegationCRUD, "get_by_id", missing_row)
    with pytest.raises(AtprotoIdentityDelegationInvariantError):
        await AtprotoIdentityDelegationCRUD.grant(
            test_db,
            organization_id="org_1",
            identity_id=identity.id,
            controller_user_id="owner_1",
            delegate_user_id="member_1",
            granted_by="owner_1",
        )


@pytest.mark.asyncio
async def test_revocation_fails_closed_when_the_audit_row_cannot_be_reloaded(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:delegation-revoke-invariant",
        handle="delegation-revoke-invariant.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    delegation = await AtprotoIdentityDelegationCRUD.grant(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        controller_user_id="owner_1",
        delegate_user_id="member_1",
        granted_by="owner_1",
    )

    async def missing_row(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityDelegationCRUD, "get_by_id", missing_row)
    with pytest.raises(AtprotoIdentityDelegationInvariantError):
        await AtprotoIdentityDelegationCRUD.revoke(
            test_db,
            organization_id="org_1",
            identity_id=identity.id,
            delegate_user_id=delegation.delegate_user_id,
            revoked_by="owner_1",
        )


@pytest.mark.asyncio
async def test_reattach_restores_the_same_auditable_organization_identity(test_db: object) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:organization-reattach",
        handle="organization-reattach.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    attached = await OrganizationAtprotoIdentityCRUD.attach(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        attached_by="owner_1",
    )
    await OrganizationAtprotoIdentityCRUD.detach(
        test_db, relation_id=attached.id, detached_by="owner_1"
    )

    reattached = await OrganizationAtprotoIdentityCRUD.attach(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        attached_by="admin_1",
    )

    assert reattached.id == attached.id
    assert reattached.status == "active"
    assert reattached.attached_by == "admin_1"
    assert reattached.detached_by is None


@pytest.mark.asyncio
async def test_organization_identity_writes_fail_closed_when_the_relation_disappears(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:organization-write-invariant",
        handle="organization-write-invariant.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )

    async def missing_row(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(OrganizationAtprotoIdentityCRUD, "get_by_id", missing_row)
    with pytest.raises(OrganizationAtprotoIdentityInvariantError):
        await OrganizationAtprotoIdentityCRUD.attach(
            test_db,
            organization_id="org_1",
            identity_id=identity.id,
            attached_by="owner_1",
        )


@pytest.mark.asyncio
async def test_organization_identity_removal_fails_closed_when_the_relation_disappears(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:organization-removal-invariant",
        handle="organization-removal-invariant.atlas.localhost",
        pds_url="https://pds.atlas.localhost",
    )
    relation = await OrganizationAtprotoIdentityCRUD.attach(
        test_db,
        organization_id="org_1",
        identity_id=identity.id,
        attached_by="owner_1",
    )

    async def missing_row(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(OrganizationAtprotoIdentityCRUD, "get_by_id", missing_row)
    with pytest.raises(OrganizationAtprotoIdentityInvariantError):
        await OrganizationAtprotoIdentityCRUD.detach(
            test_db, relation_id=relation.id, detached_by="owner_1"
        )
