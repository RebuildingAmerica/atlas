"""WebSocket authentication helpers for the Firehose API."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import WebSocket, WebSocketException, status

from atlas.domains.access import AuthenticatedActor
from atlas.domains.access.internal import build_local_actor, verify_internal_actor
from atlas.domains.access.permissions import require_permission

if TYPE_CHECKING:
    from atlas.domains.access.principals import ApiKeyPrincipal
    from atlas.platform.config import Settings


def _api_key_actor(principal: ApiKeyPrincipal) -> AuthenticatedActor:
    """Convert an API key principal into the shared actor shape."""
    return AuthenticatedActor(
        user_id=principal.user_id,
        email=principal.user_email,
        auth_type="api_key",
        api_key_id=principal.key_id,
        permissions=principal.permissions,
        org_id=principal.org_id,
    )


async def _websocket_actor(websocket: WebSocket, settings: Settings) -> AuthenticatedActor:
    """Authenticate a WebSocket caller for the Firehose session socket."""
    from . import api as firehose_api

    if settings.deploy_mode == "local":
        return build_local_actor()

    trusted_actor = verify_internal_actor(
        settings,
        websocket.headers.get("x-atlas-internal-secret"),
        websocket.headers.get("x-atlas-actor-id"),
        websocket.headers.get("x-atlas-actor-email"),
        org_id=websocket.headers.get("x-atlas-organization-id"),
    )
    if trusted_actor is not None:
        if trusted_actor.org_id is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
        return trusted_actor

    api_key = websocket.headers.get("x-api-key")
    if api_key:
        principal = await firehose_api.verify_api_key(api_key, settings)
        if principal is not None:
            actor = require_permission(_api_key_actor(principal), "firehose", "read")
            if actor.org_id is None:
                raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
            return actor

    jwt_payload = firehose_api.verify_bearer_jwt(
        websocket.headers.get("authorization"),
        issuer=settings.auth_jwt_issuer,
        audience=settings.auth_jwt_audience,
        jwks_url=settings.auth_jwt_jwks_url,
    )
    if jwt_payload:
        raw_org_id = jwt_payload.get("org_id")
        actor = AuthenticatedActor(
            user_id=str(jwt_payload["sub"]),
            email=str(jwt_payload.get("email", "")),
            auth_type="oauth_jwt",
            permissions=jwt_payload.get("permissions"),  # type: ignore[arg-type]
            org_id=str(raw_org_id) if raw_org_id is not None else None,
        )
        actor = require_permission(actor, "firehose", "read", settings=settings)
        if actor.org_id is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
        return actor

    raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)


def _websocket_subprotocol(websocket: WebSocket) -> str | None:
    """Return the negotiated Firehose WebSocket subprotocol."""
    raw_protocols = websocket.headers.get("sec-websocket-protocol")
    if raw_protocols is None:
        return None
    requested_protocols = [value.strip() for value in raw_protocols.split(",") if value.strip()]
    from .http import FIREHOSE_WEBSOCKET_PROTOCOL

    if FIREHOSE_WEBSOCKET_PROTOCOL in requested_protocols:
        return FIREHOSE_WEBSOCKET_PROTOCOL
    raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
