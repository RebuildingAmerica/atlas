"""Organization-scoped ATProto identity administration APIs."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_org_role
from atlas.domains.access.membership import verify_org_membership
from atlas.domains.catalog.api.profile_claim_helpers import get_db
from atlas.domains.catalog.models.atproto_identity_controls import AtprotoIdentityControlCRUD
from atlas.domains.catalog.models.atproto_identity_delegations import (
    AtprotoIdentityDelegationCRUD,
    AtprotoIdentityDelegationModel,
    AtprotoIdentityDelegationNotFoundError,
)
from atlas.domains.catalog.models.organization_atproto_identities import (
    OrganizationAtprotoIdentityConflictError,
    OrganizationAtprotoIdentityCRUD,
    OrganizationAtprotoIdentityModel,
)
from atlas.domains.catalog.schemas.public import (
    AtprotoIdentityDelegationRequest,
    AtprotoIdentityDelegationResponse,
    OrganizationAtprotoIdentityAttachRequest,
    OrganizationAtprotoIdentityResponse,
)
from atlas.platform.config import get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter()

OrganizationAtprotoIdentityResponseStatus = Literal["active", "removed"]
AtprotoIdentityDelegationResponseStatus = Literal["active", "revoked"]


class UnsupportedOrganizationIdentityTimestampError(TypeError):
    """Raised when database timestamp values cannot be serialized."""

    def __init__(self) -> None:
        super().__init__("unsupported organization identity timestamp")


class MissingOrganizationIdentityTimestampError(TypeError):
    """Raised when a required response timestamp is absent."""

    def __init__(self, field: str) -> None:
        super().__init__(f"missing {field}")


def _assert_organization_context(actor: AuthenticatedActor, organization_id: str) -> None:
    if actor.org_id != organization_id:
        raise HTTPException(
            status_code=403, detail="Organization context does not match this route."
        )


async def _assert_delegate_is_member(delegate_user_id: str, organization_id: str) -> None:
    """Require the delegated administrator to still belong to the workspace.

    Local development intentionally has no remote membership authority. Hosted
    deployments always configure it and therefore cannot grant authority to an
    arbitrary Atlas account.
    """
    settings = get_settings()
    if not settings.auth_membership_verification_url:
        return
    membership = await verify_org_membership(delegate_user_id, organization_id, settings)
    if membership is None:
        raise HTTPException(status_code=403, detail="Delegate must be a workspace member.")


def _organization_response(
    row: OrganizationAtprotoIdentityModel,
) -> OrganizationAtprotoIdentityResponse:
    return OrganizationAtprotoIdentityResponse(
        id=row.id,
        organization_id=row.organization_id,
        identity_id=row.identity_id,
        status=cast("OrganizationAtprotoIdentityResponseStatus", row.status),
        attached_by=row.attached_by,
        attached_at=_required_response_timestamp(row.attached_at, field="attached_at"),
        detached_by=row.detached_by,
        detached_at=_response_timestamp(row.detached_at),
    )


def _delegation_response(row: AtprotoIdentityDelegationModel) -> AtprotoIdentityDelegationResponse:
    return AtprotoIdentityDelegationResponse(
        id=row.id,
        organization_id=row.organization_id,
        identity_id=row.identity_id,
        controller_user_id=row.controller_user_id,
        delegate_user_id=row.delegate_user_id,
        status=cast("AtprotoIdentityDelegationResponseStatus", row.status),
        granted_by=row.granted_by,
        granted_at=_required_response_timestamp(row.granted_at, field="granted_at"),
        revoked_by=row.revoked_by,
        revoked_at=_response_timestamp(row.revoked_at),
    )


def _response_timestamp(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    raise UnsupportedOrganizationIdentityTimestampError


def _required_response_timestamp(value: object, *, field: str) -> str:
    timestamp = _response_timestamp(value)
    if timestamp is None:
        raise MissingOrganizationIdentityTimestampError(field)
    return timestamp


async def _require_identity_administrator(
    db: aiosqlite.Connection,
    *,
    actor: AuthenticatedActor,
    organization_id: str,
    identity_id: str,
) -> OrganizationAtprotoIdentityModel:
    """Return an active relation when the actor may administer its organization link.

    Owners and admins administer every workspace identity. A member needs an
    active, identity-specific delegation; no delegation grants account-level
    DID control or profile-content authority.
    """
    relation = await OrganizationAtprotoIdentityCRUD.get_for_organization_and_identity(
        db, organization_id=organization_id, identity_id=identity_id
    )
    if relation is None or relation.status != "active":
        raise HTTPException(status_code=404, detail="Organization ATProto identity not found.")
    if actor.org_role in {"owner", "admin"}:
        return relation
    if await AtprotoIdentityDelegationCRUD.is_active_delegate(
        db,
        organization_id=organization_id,
        identity_id=identity_id,
        delegate_user_id=actor.user_id,
    ):
        return relation
    raise HTTPException(status_code=403, detail="ATProto identity administration is not delegated.")


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
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("member")),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrganizationAtprotoIdentityResponse | None:
    """Return the active public identity for an organization, if it has one."""
    _assert_organization_context(actor, org_id)
    relation = await OrganizationAtprotoIdentityCRUD.get_active(db, org_id)
    apply_no_store_headers(response)
    if relation is None:
        return None
    return _organization_response(relation)


@router.delete(
    "/atproto-identities/{identity_id}",
    response_model=OrganizationAtprotoIdentityResponse,
    operation_id="detachOrganizationAtprotoIdentity",
    summary="Remove the active organization ATProto identity",
    description=(
        "Remove only the public organization association. Owners and admins may always do this; "
        "members need an active delegation for this exact identity. The underlying DID remains "
        "controlled by its Atlas account."
    ),
    tags=["organization-identity"],
)
async def detach_organization_atproto_identity(
    org_id: str,
    identity_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("member")),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrganizationAtprotoIdentityResponse:
    """Remove an active organization association without transferring DID control."""
    _assert_organization_context(actor, org_id)
    relation = await _require_identity_administrator(
        db,
        actor=actor,
        organization_id=org_id,
        identity_id=identity_id,
    )
    detached = await OrganizationAtprotoIdentityCRUD.detach(
        db, relation_id=relation.id, detached_by=actor.user_id
    )
    await db.commit()
    apply_no_store_headers(response)
    return _organization_response(detached)


@router.post(
    "/atproto-identities",
    response_model=OrganizationAtprotoIdentityResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="attachOrganizationAtprotoIdentity",
    tags=["organization-identity"],
)
async def attach_organization_atproto_identity(
    org_id: str,
    payload: OrganizationAtprotoIdentityAttachRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrganizationAtprotoIdentityResponse:
    """Attach an account-controlled DID as the organization's active public identity.

    The caller must be an owner or admin in the matching workspace and must actively control the
    DID through Atlas. Atlas records the relationship without transferring personal DID control.
    """
    _assert_organization_context(actor, org_id)
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
            organization_id=org_id,
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
    org_id: str,
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
    _assert_organization_context(actor, org_id)
    attached = await OrganizationAtprotoIdentityCRUD.get_for_organization_and_identity(
        db, organization_id=org_id, identity_id=identity_id
    )
    control = await AtprotoIdentityControlCRUD.get_active_for_user_and_identity(
        db, user_id=actor.user_id, identity_id=identity_id
    )
    if attached is None or attached.status != "active" or control is None:
        raise HTTPException(
            status_code=403, detail="ATProto identity is not controlled for this organization."
        )
    await _assert_delegate_is_member(payload.delegate_user_id, org_id)
    delegation = await AtprotoIdentityDelegationCRUD.grant(
        db,
        organization_id=org_id,
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
    org_id: str,
    identity_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_role("member")),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[AtprotoIdentityDelegationResponse]:
    """List active delegated administrators for the active organization identity."""
    _assert_organization_context(actor, org_id)
    attached = await OrganizationAtprotoIdentityCRUD.get_for_organization_and_identity(
        db, organization_id=org_id, identity_id=identity_id
    )
    if attached is None or attached.status != "active":
        raise HTTPException(status_code=404, detail="Organization ATProto identity not found.")
    delegations = await AtprotoIdentityDelegationCRUD.list_active(
        db, organization_id=org_id, identity_id=identity_id
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
    org_id: str,
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
    _assert_organization_context(actor, org_id)
    try:
        delegation = await AtprotoIdentityDelegationCRUD.revoke(
            db,
            organization_id=org_id,
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
