"""Tests for organization ATProto identity administration APIs."""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api.organization_atproto_identities import (
    attach_organization_atproto_identity,
    grant_organization_atproto_delegation,
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
