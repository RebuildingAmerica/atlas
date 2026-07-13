"""Owner/admin APIs for organization-scoped ATProto identity administration."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_org_role
from atlas.domains.catalog.api.profile_claim_helpers import get_db
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.atproto_identity_delegations import (
    AtprotoIdentityDelegationCRUD,
    AtprotoIdentityDelegationNotFoundError,
)
from atlas.domains.catalog.models.organization_atproto_identities import (
    OrganizationAtprotoIdentityConflictError,
    OrganizationAtprotoIdentityCRUD,
)
from atlas.domains.catalog.schemas.public import (
    AtprotoIdentityDelegationRequest,
    AtprotoIdentityDelegationResponse,
    OrganizationAtprotoIdentityAttachRequest,
    OrganizationAtprotoIdentityResponse,
)
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter()


def _assert_organization_context(actor: AuthenticatedActor, organization_id: str) -> None:
    if actor.org_id != organization_id:
        raise HTTPException(
            status_code=403, detail="Organization context does not match this route."
        )


def _organization_response(row: object) -> OrganizationAtprotoIdentityResponse:
    return OrganizationAtprotoIdentityResponse.model_validate(row, from_attributes=True)


def _delegation_response(row: object) -> AtprotoIdentityDelegationResponse:
    return AtprotoIdentityDelegationResponse.model_validate(row, from_attributes=True)


@router.get(
    "/atproto-identities",
    response_model=OrganizationAtprotoIdentityResponse | None,
    operation_id="getOrganizationAtprotoIdentity",
    summary="Get the active organization ATProto identity",
    description=(
        "Return the single active public identity assigned to this organization, or null when none "
        "is assigned. The result is limited to the caller's active workspace and is no-store because "
        "organization identity administration reveals an account-controlled DID relationship."
    ),
    tags=["organization-identity"],
)
async def get_organization_atproto_identity(
    organization_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrganizationAtprotoIdentityResponse | None:
    """Return the active public identity for an organization, if it has one."""
    _assert_organization_context(actor, organization_id)
    relation = await OrganizationAtprotoIdentityCRUD.get_active(db, organization_id)
    apply_no_store_headers(response)
    if relation is None:
        return None
    return _organization_response(relation)


@router.post(
    "/atproto-identities",
    response_model=OrganizationAtprotoIdentityResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="attachOrganizationAtprotoIdentity",
    tags=["organization-identity"],
)
async def attach_organization_atproto_identity(
    organization_id: str,
    payload: OrganizationAtprotoIdentityAttachRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrganizationAtprotoIdentityResponse:
    """Attach an account-controlled DID as the organization's active public identity.

    The caller must be an owner or admin in the matching workspace and must actively control the
    DID through Atlas. Atlas records the relationship without transferring personal DID control.
    """
    _assert_organization_context(actor, organization_id)
    control = await AtprotoIdentityControlCRUD.get_active_for_user_and_identity(
        db, user_id=actor.user_id, identity_id=payload.identity_id
    )
    if control is None:
        raise HTTPException(
            status_code=403, detail="ATProto identity is not controlled by this account."
        )
    try:
        relation = await OrganizationAtprotoIdentityCRUD.attach(
            db,
            organization_id=organization_id,
            identity_id=payload.identity_id,
            attached_by=actor.user_id,
        )
    except OrganizationAtprotoIdentityConflictError as error:
        raise HTTPException(
            status_code=409, detail="Organization already has a different active ATProto identity."
        ) from error
    await db.commit()
    apply_no_store_headers(response)
    return _organization_response(relation)


@router.post(
    "/atproto-identities/{identity_id}/delegations",
    response_model=AtprotoIdentityDelegationResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="grantOrganizationAtprotoIdentityDelegation",
    tags=["organization-identity"],
)
async def grant_organization_atproto_delegation(  # noqa: PLR0913 - FastAPI dependency parameters
    organization_id: str,
    identity_id: str,
    payload: AtprotoIdentityDelegationRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> AtprotoIdentityDelegationResponse:
    """Grant a member revocable authority to administer this organization's active DID.

    The controlling owner or admin retains account-level control; this relation only permits the
    named member to act for this workspace identity until an administrator explicitly revokes it.
    """
    _assert_organization_context(actor, organization_id)
    attached = await OrganizationAtprotoIdentityCRUD.get_for_organization_and_identity(
        db, organization_id=organization_id, identity_id=identity_id
    )
    control = await AtprotoIdentityControlCRUD.get_active_for_user_and_identity(
        db, user_id=actor.user_id, identity_id=identity_id
    )
    if attached is None or attached.status != "active" or control is None:
        raise HTTPException(
            status_code=403, detail="ATProto identity is not controlled for this organization."
        )
    delegation = await AtprotoIdentityDelegationCRUD.grant(
        db,
        organization_id=organization_id,
        identity_id=identity_id,
        controller_user_id=actor.user_id,
        delegate_user_id=payload.delegate_user_id,
        granted_by=actor.user_id,
    )
    await db.commit()
    apply_no_store_headers(response)
    return _delegation_response(delegation)


@router.get(
    "/atproto-identities/{identity_id}/delegations",
    response_model=list[AtprotoIdentityDelegationResponse],
    operation_id="listOrganizationAtprotoIdentityDelegations",
    summary="List active delegated identity administrators",
    description=(
        "Return only members who currently hold delegated authority for the organization's active "
        "ATProto identity. Revoked grants remain auditable but are deliberately excluded, and callers "
        "receive a privacy-safe not-found response when the DID is not the active organization identity."
    ),
    tags=["organization-identity"],
)
async def list_organization_atproto_delegations(
    organization_id: str,
    identity_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[AtprotoIdentityDelegationResponse]:
    """List active delegated administrators for the active organization identity."""
    _assert_organization_context(actor, organization_id)
    attached = await OrganizationAtprotoIdentityCRUD.get_for_organization_and_identity(
        db, organization_id=organization_id, identity_id=identity_id
    )
    if attached is None or attached.status != "active":
        raise HTTPException(status_code=404, detail="Organization ATProto identity not found.")
    delegations = await AtprotoIdentityDelegationCRUD.list_active(
        db, organization_id=organization_id, identity_id=identity_id
    )
    apply_no_store_headers(response)
    return [_delegation_response(delegation) for delegation in delegations]


@router.delete(
    "/atproto-identities/{identity_id}/delegations/{delegate_user_id}",
    response_model=AtprotoIdentityDelegationResponse,
    operation_id="revokeOrganizationAtprotoIdentityDelegation",
    tags=["organization-identity"],
)
async def revoke_organization_atproto_delegation(  # noqa: PLR0913 - FastAPI dependency parameters
    organization_id: str,
    identity_id: str,
    delegate_user_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> AtprotoIdentityDelegationResponse:
    """Revoke a member's organization-specific identity administration immediately.

    The revoked relation remains auditable, while all future actions requiring delegated authority
    fail until an authorized owner or admin grants a new active delegation for the same workspace.
    """
    _assert_organization_context(actor, organization_id)
    try:
        delegation = await AtprotoIdentityDelegationCRUD.revoke(
            db,
            organization_id=organization_id,
            identity_id=identity_id,
            delegate_user_id=delegate_user_id,
            revoked_by=actor.user_id,
        )
    except AtprotoIdentityDelegationNotFoundError as error:
        raise HTTPException(
            status_code=404, detail="ATProto identity delegation not found."
        ) from error
    await db.commit()
    apply_no_store_headers(response)
    return _delegation_response(delegation)
