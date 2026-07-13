"""Tests for organization ownership and delegated ATProto identity administration."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_delegations import AtprotoIdentityDelegationCRUD
from atlas.domains.catalog.models.organization_atproto_identities import (
    OrganizationAtprotoIdentityCRUD,
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
