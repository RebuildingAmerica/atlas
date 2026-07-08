"""ATProto identity linking routes for profile verification."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.catalog.api.profile_claim_helpers import get_db
from atlas.domains.catalog.models.atproto_identities import (
    AtprotoIdentityCRUD,
    AtprotoIdentityModel,
)
from atlas.domains.catalog.schemas.public import (
    AtprotoIdentityLinkRequest,
    AtprotoIdentityResponse,
)
from atlas.domains.catalog.services.atproto_identity import verify_current_atproto_identity
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter()


def _identity_to_response(identity: AtprotoIdentityModel) -> AtprotoIdentityResponse:
    return AtprotoIdentityResponse(
        id=identity.id,
        user_id=identity.user_id,
        did=identity.did,
        current_handle=identity.current_handle,
        pds_url=identity.pds_url,
        did_resolved_at=identity.did_resolved_at,
        handle_verified_at=identity.handle_verified_at,
        created_at=identity.created_at,
        updated_at=identity.updated_at,
    )


@router.post(
    "/atproto/identities",
    response_model=AtprotoIdentityResponse,
    summary="Link an ATProto identity",
    description="Stores a DID-backed ATProto identity for the authenticated user.",
    operation_id="linkAtprotoIdentity",
    status_code=status.HTTP_201_CREATED,
    tags=["claims"],
)
async def link_atproto_identity(
    payload: AtprotoIdentityLinkRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> AtprotoIdentityResponse:
    """Persist an ATProto identity linked through the app OAuth callback."""
    if actor.auth_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ATProto identities must be linked through Atlas.",
        )
    if not await _verify_linked_atproto_identity(payload.current_handle, payload.did):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ATProto identity could not be verified.",
        )
    identity = await AtprotoIdentityCRUD.upsert(
        db,
        user_id=actor.user_id,
        did=payload.did,
        handle=payload.current_handle,
        pds_url=payload.pds_url,
    )
    apply_no_store_headers(response)
    return _identity_to_response(identity)


async def _verify_linked_atproto_identity(handle: str, did: str) -> bool:
    if _e2e_harness_identity_matches(handle, did):
        return True
    return await verify_current_atproto_identity(handle, did)


def _e2e_harness_identity_matches(handle: str, did: str) -> bool:
    if os.environ.get("ATLAS_ATPROTO_OAUTH_E2E_HARNESS") != "1":
        return False
    normalized = handle.strip().lower().removeprefix("@")
    return did == f"did:web:{normalized}"
