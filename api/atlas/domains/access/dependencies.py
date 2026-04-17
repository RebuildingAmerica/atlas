"""FastAPI auth dependencies."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import Depends, Header, HTTPException, Request, status

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

from atlas.platform.config import Settings, get_settings

from .api_keys import verify_api_key
from .internal import build_local_actor, verify_internal_actor
from .jwt import verify_bearer_jwt
from .permissions import require_permission
from .principals import AuthenticatedActor

logger = logging.getLogger(__name__)


async def require_actor(  # noqa: PLR0913
    request: Request,
    settings: Settings = Depends(get_settings),
    x_atlas_internal_secret: str | None = Header(None),
    x_atlas_actor_id: str | None = Header(None),
    x_atlas_actor_email: str | None = Header(None),
    x_api_key: str | None = Header(None),
) -> AuthenticatedActor:
    """Require an authenticated actor unless local mode disables auth."""
    if settings.deploy_mode == "local":
        return build_local_actor()

    trusted_actor = verify_internal_actor(
        settings,
        x_atlas_internal_secret,
        x_atlas_actor_id,
        x_atlas_actor_email,
    )
    if trusted_actor is not None:
        return trusted_actor

    if x_api_key:
        principal = await verify_api_key(x_api_key, settings)
        if principal is not None:
            logger.debug(
                "Accepted API key principal for protected request",
                extra={
                    "api_key_id": principal.key_id,
                    "permissions": principal.permissions,
                    "user_id": principal.user_id,
                },
            )
            return AuthenticatedActor(
                user_id=principal.user_id,
                email=principal.user_email,
                auth_type="api_key",
                api_key_id=principal.key_id,
                permissions=principal.permissions,
            )

    jwt_payload = verify_bearer_jwt(
        request.headers.get("authorization"),
        issuer=settings.auth_jwt_issuer,
        audience=settings.auth_jwt_audience,
        jwks_url=settings.auth_jwt_jwks_url,
    )
    if jwt_payload:
        return AuthenticatedActor(
            user_id=str(jwt_payload["sub"]),
            email=str(jwt_payload.get("email", "")),
            auth_type="oauth_jwt",
            permissions=jwt_payload.get("permissions"),  # type: ignore[arg-type]
        )

    # MCP clients use the WWW-Authenticate header to discover the auth server.
    resource_metadata_url = (
        f"{settings.auth_jwt_audience.rstrip('/')}/.well-known/oauth-protected-resource"
        if settings.auth_jwt_audience
        else ""
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={
            "WWW-Authenticate": f'Bearer resource_metadata="{resource_metadata_url}"',
        }
        if resource_metadata_url
        else None,
    )


def require_actor_permission(
    resource: str,
    action: str,
) -> Callable[..., Awaitable[AuthenticatedActor]]:
    """Create a dependency that enforces an actor permission."""

    async def dependency(
        actor: AuthenticatedActor = Depends(require_actor),
    ) -> AuthenticatedActor:
        return require_permission(actor, resource, action)

    return dependency
