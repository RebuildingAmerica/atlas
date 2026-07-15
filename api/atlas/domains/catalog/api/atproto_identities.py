"""Account lifecycle routes for external ATProto identities."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.catalog.api.profile_claim_helpers import get_db
from atlas.domains.catalog.models.atproto_identities import (
    AtprotoIdentityCRUD,
    AtprotoIdentityModel,
)
from atlas.domains.catalog.models.atproto_identity_controls import (
    AtprotoIdentityControlConflictError,
    AtprotoIdentityControlCRUD,
    AtprotoIdentityControlModel,
)
from atlas.domains.catalog.models.profile_atproto_links import ProfileAtprotoLinkCRUD
from atlas.domains.catalog.schemas.public import (
    AtprotoIdentityLinkRequest,
    AtprotoIdentityProfileSummary,
    AtprotoIdentityResponse,
    AtprotoIdentitySignInResolveRequest,
    AtprotoIdentitySignInResolveResponse,
)
from atlas.domains.catalog.services.atproto_identity import (
    resolve_current_atproto_identity,
    verify_linked_atproto_identity,
)
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter()


class UnsupportedAtprotoTimestampError(TypeError):
    """Raised when database timestamp values cannot be serialized."""

    def __init__(self) -> None:
        super().__init__("unsupported timestamp")


class MissingAtprotoTimestampError(TypeError):
    """Raised when a required response timestamp is absent."""

    def __init__(self, field: str) -> None:
        super().__init__(f"missing {field}")


def _require_app_actor(actor: AuthenticatedActor) -> None:
    if actor.auth_type != "internal" and not actor.is_local:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ATProto identities must be managed through Atlas.",
        )


def _response_timestamp(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    raise UnsupportedAtprotoTimestampError


def _required_response_timestamp(value: object, *, field: str) -> str:
    timestamp = _response_timestamp(value)
    if timestamp is None:
        raise MissingAtprotoTimestampError(field)
    return timestamp


@router.post(
    "/sign-in/resolve",
    response_model=AtprotoIdentitySignInResolveResponse,
    operation_id="resolveAtprotoSignIn",
    summary="Resolve an internal ATProto sign-in controller",
    include_in_schema=False,
)
async def resolve_atproto_sign_in(
    payload: AtprotoIdentitySignInResolveRequest,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> AtprotoIdentitySignInResolveResponse:
    """Return the active controller only to the internal app OAuth callback."""
    _require_app_actor(actor)
    identity = await AtprotoIdentityCRUD.get_by_did(db, payload.did)
    control = (
        await AtprotoIdentityControlCRUD.get_active_for_identity(db, identity.id)
        if identity is not None and identity.resolution_status == "verified"
        else None
    )
    if control is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ATProto sign-in unavailable."
        )
    return AtprotoIdentitySignInResolveResponse(user_id=control.user_id)


async def _identity_to_response(
    conn: aiosqlite.Connection,
    identity: AtprotoIdentityModel,
    control: AtprotoIdentityControlModel,
) -> AtprotoIdentityResponse:
    profiles = await ProfileAtprotoLinkCRUD.list_profile_summaries(conn, identity.id)
    return AtprotoIdentityResponse(
        id=identity.id,
        did=identity.did,
        current_handle=identity.current_handle,
        pds_url=identity.pds_url,
        resolution_status=identity.resolution_status,
        control_status=control.status,
        connected_at=_required_response_timestamp(control.created_at, field="connected_at"),
        verified_at=_response_timestamp(control.verified_at),
        last_checked_at=_response_timestamp(identity.did_resolved_at),
        last_resolution_error=identity.last_resolution_error,
        profiles=[
            AtprotoIdentityProfileSummary(
                id=profile.id,
                name=profile.name,
                slug=profile.slug,
                type=profile.type,
            )
            for profile in profiles
        ],
    )


@router.get(
    "",
    response_model=list[AtprotoIdentityResponse],
    operation_id="listAtprotoIdentities",
    summary="List connected ATProto identities",
    description=(
        "Return the current account's active or attention-required ATProto controls for Account "
        "settings. Disconnected history and other users' metadata are excluded, while affected "
        "public profiles are summarized so disconnect consequences remain understandable."
    ),
    tags=["identity"],
)
async def list_atproto_identities(
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[AtprotoIdentityResponse]:
    """List active and attention-required identities for the current account."""
    _require_app_actor(actor)
    result: list[AtprotoIdentityResponse] = []
    for control in await AtprotoIdentityControlCRUD.list_for_user(db, actor.user_id):
        identity = await AtprotoIdentityCRUD.get_by_id(db, control.identity_id)
        if identity is not None:
            result.append(await _identity_to_response(db, identity, control))
    apply_no_store_headers(response)
    return result


@router.post(
    "",
    response_model=AtprotoIdentityResponse,
    operation_id="linkAtprotoIdentity",
    summary="Connect an ATProto identity",
    description=(
        "Accept a short-lived app-server OAuth result, verify the handle and DID again, and record "
        "an active account-control relationship. A competing controller receives a privacy-safe "
        "conflict without any other account metadata or workspace side effects."
    ),
    status_code=status.HTTP_201_CREATED,
    tags=["identity"],
)
async def link_atproto_identity(
    payload: AtprotoIdentityLinkRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> AtprotoIdentityResponse:
    """Persist a reverified app-server OAuth result and active control relation."""
    _require_app_actor(actor)
    if not await _verify_linked_atproto_identity(payload.current_handle, payload.did):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ATProto identity could not be verified.",
        )
    try:
        identity, control = await AtprotoIdentityControlCRUD.connect(
            db,
            user_id=actor.user_id,
            did=payload.did,
            handle=payload.current_handle,
            pds_url=payload.pds_url,
        )
    except AtprotoIdentityControlConflictError as error:
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ATProto identity is already connected to another Atlas account.",
        ) from error
    await db.commit()
    apply_no_store_headers(response)
    return await _identity_to_response(db, identity, control)


@router.post(
    "/{identity_id}/refresh",
    response_model=AtprotoIdentityResponse,
    operation_id="refreshAtprotoIdentity",
    summary="Check an ATProto identity connection",
    description=(
        "Resolve the controlled DID first, verify its current handle in both directions, and update "
        "account metadata. Failed resolution retains the DID and profile provenance but marks the "
        "identity and its public links as needing attention."
    ),
    tags=["identity"],
)
async def refresh_atproto_identity(
    identity_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> AtprotoIdentityResponse:
    """Resolve a controlled DID and update its current trustworthy state."""
    _require_app_actor(actor)
    identity, control = await _controlled_identity(db, actor.user_id, identity_id)
    resolution = await resolve_current_atproto_identity(identity.did)
    if resolution is None:
        await AtprotoIdentityCRUD.mark_needs_attention(
            db, identity.id, error="Current DID and handle could not be verified."
        )
        await db.execute(
            """
            UPDATE profile_atproto_links
            SET status = 'reverification_required', last_checked_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE identity_id = ? AND status <> 'removed'
            """,
            (identity.id,),
        )
    else:
        identity = await AtprotoIdentityCRUD.upsert(
            db,
            did=resolution.did,
            handle=resolution.handle,
            pds_url=resolution.pds_url,
        )
    await db.commit()
    refreshed = await AtprotoIdentityCRUD.get_by_id(db, identity.id)
    if refreshed is None:
        raise HTTPException(status_code=404, detail="ATProto identity not found.")
    apply_no_store_headers(response)
    return await _identity_to_response(db, refreshed, control)


@router.delete(
    "/{identity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="disconnectAtprotoIdentity",
    summary="Disconnect an ATProto identity",
    description=(
        "Disconnect the current account's control relationship so the identity cannot be selected "
        "for new actions. Existing verified public-profile links remain auditable until a verified "
        "profile steward explicitly removes or replaces them."
    ),
    tags=["identity"],
)
async def disconnect_atproto_identity(
    identity_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Disconnect account control while retaining public profile provenance."""
    _require_app_actor(actor)
    disconnected = await AtprotoIdentityControlCRUD.disconnect(
        db, user_id=actor.user_id, identity_id=identity_id
    )
    if not disconnected:
        raise HTTPException(status_code=404, detail="ATProto identity not found.")
    await db.commit()
    apply_no_store_headers(response)
    response.status_code = status.HTTP_204_NO_CONTENT


async def _controlled_identity(
    conn: aiosqlite.Connection, user_id: str, identity_id: str
) -> tuple[AtprotoIdentityModel, AtprotoIdentityControlModel]:
    control = await AtprotoIdentityControlCRUD.get_for_user_and_identity(
        conn, user_id=user_id, identity_id=identity_id
    )
    identity = await AtprotoIdentityCRUD.get_by_id(conn, identity_id)
    if control is None or control.status == "disconnected" or identity is None:
        raise HTTPException(status_code=404, detail="ATProto identity not found.")
    return identity, control


async def _verify_linked_atproto_identity(handle: str, did: str) -> bool:
    return await verify_linked_atproto_identity(handle, did)
