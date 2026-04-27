"""FastAPI auth dependencies."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import Depends, Header, HTTPException, Request, status

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

from atlas.platform.config import Settings, get_settings

from .api_keys import verify_api_key
from .capabilities import resolve_capabilities
from .internal import build_local_actor, verify_internal_actor
from .jwt import verify_bearer_jwt
from .membership import verify_org_membership
from .permissions import require_permission
from .principals import AuthenticatedActor

logger = logging.getLogger(__name__)


async def require_actor(  # noqa: PLR0913
    request: Request,
    settings: Settings = Depends(get_settings),
    x_atlas_internal_secret: str | None = Header(None),
    x_atlas_actor_id: str | None = Header(None),
    x_atlas_actor_email: str | None = Header(None),
    x_atlas_organization_id: str | None = Header(None),
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
        org_id=x_atlas_organization_id,
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
                org_id=principal.org_id,
            )

    jwt_payload = verify_bearer_jwt(
        request.headers.get("authorization"),
        issuer=settings.auth_jwt_issuer,
        audience=settings.auth_jwt_audience,
        jwks_url=settings.auth_jwt_jwks_url,
    )
    if jwt_payload:
        raw_org_id = jwt_payload.get("org_id")
        return AuthenticatedActor(
            user_id=str(jwt_payload["sub"]),
            email=str(jwt_payload.get("email", "")),
            auth_type="oauth_jwt",
            permissions=jwt_payload.get("permissions"),  # type: ignore[arg-type]
            org_id=str(raw_org_id) if raw_org_id is not None else None,
        )

    # MCP clients use the WWW-Authenticate header to discover the auth server.
    # When auth is enabled (settings validated at startup), the resource URL is
    # always set, so RFC 6750 §3 challenges always carry a discovery pointer.
    resource_url = settings.auth_jwt_resource_url.rstrip("/")
    resource_metadata_url = f"{resource_url}/.well-known/oauth-protected-resource"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={
            "WWW-Authenticate": f'Bearer resource_metadata="{resource_metadata_url}"',
        },
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


def require_org_actor_permission(
    resource: str,
    action: str,
) -> Callable[..., Awaitable[AuthenticatedActor]]:
    """Create a dependency that enforces org context and a resource permission."""

    async def dependency(
        actor: AuthenticatedActor = Depends(require_org_actor),
    ) -> AuthenticatedActor:
        return require_permission(actor, resource, action)

    return dependency


_ORG_ROLE_HIERARCHY: dict[str, int] = {
    "member": 0,
    "admin": 1,
    "owner": 2,
}


async def require_org_actor(
    actor: AuthenticatedActor = Depends(require_actor),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedActor:
    """Require auth + verified org context. Raises 403 if no org or membership invalid."""
    if actor.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context required",
        )

    if not settings.auth_membership_verification_url:
        # Dev/local mode: trust the org_id from the token as-is.
        actor.active_products = []
        actor.resolved_capabilities = resolve_capabilities([])
        return actor

    result = await verify_org_membership(actor.user_id, actor.org_id, settings)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of the specified organization",
        )

    actor.org_role = result.role
    actor.org_slug = result.slug
    actor.workspace_type = result.workspace_type
    actor.active_products = result.active_products
    actor.resolved_capabilities = resolve_capabilities(result.active_products)
    return actor


def require_org_role(
    min_role: str,
) -> Callable[..., Awaitable[AuthenticatedActor]]:
    """Create a dependency requiring at least the specified org role.

    Role hierarchy: member < admin < owner.
    """
    min_level = _ORG_ROLE_HIERARCHY.get(min_role)
    if min_level is None:
        msg = f"Unknown org role: {min_role!r}. Expected one of {list(_ORG_ROLE_HIERARCHY)}"
        raise ValueError(msg)

    async def dependency(
        actor: AuthenticatedActor = Depends(require_org_actor),
    ) -> AuthenticatedActor:
        actor_level = _ORG_ROLE_HIERARCHY.get(actor.org_role or "", -1)
        if actor_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires at least '{min_role}' role in the organization",
            )
        return actor

    return dependency
