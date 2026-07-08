"""FastAPI auth dependencies."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import Depends, Header, HTTPException, Request, status
from starlette.routing import Route

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Awaitable, Callable

    import aiosqlite

from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import db as db_util

from .api_keys import verify_api_key
from .capabilities import get_limit, resolve_capabilities
from .challenges import build_bearer_challenge
from .internal import build_local_actor, verify_internal_actor
from .jwt import verify_bearer_jwt
from .membership import verify_org_membership
from .models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from .permissions import require_permission
from .principals import ApiKeyPrincipal, AuthenticatedActor
from .request_state import api_key_principal_from_state

logger = logging.getLogger(__name__)

_EXTERNAL_API_AUTH_TYPES = frozenset({"api_key", "oauth_jwt"})
_API_USAGE_RECORDED_STATE_KEY = "_atlas_api_usage_recorded"


async def get_usage_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a request-scoped database connection for access usage accounting."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _route_usage_resource_id(request: Request) -> str:
    """Return the matched route template for low-cardinality API usage proof."""
    route = request.scope.get("route")
    if isinstance(route, Route):
        return route.path
    return request.url.path


def _current_utc_day_start_iso() -> str:
    """Return the start of the current UTC day for daily quota windows."""
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _api_quota_exceeded_detail(limit: int) -> dict[str, int | str]:
    """Build the structured detail returned when API-key quota is exhausted."""
    return {
        "error": "rate_limit_exceeded",
        "limit": "api_requests_per_day",
        "maximum": limit,
    }


async def _enforce_external_api_call_quota(
    conn: aiosqlite.Connection,
    actor: AuthenticatedActor,
) -> None:
    """Block external API-key requests that have exhausted plan daily quota."""
    if actor.auth_type != "api_key" or actor.org_id is None or actor.api_key_id is None:
        return

    resolved = actor.resolved_capabilities or resolve_capabilities(actor.active_products or [])
    actor.resolved_capabilities = resolved
    daily_limit = get_limit(resolved, "api_requests_per_day")
    if daily_limit is None:
        return

    used = await OrgUsageEventCRUD.count_api_key_calls_since(
        conn,
        org_id=actor.org_id,
        api_key_id=actor.api_key_id,
        since=_current_utc_day_start_iso(),
    )
    if used >= daily_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_api_quota_exceeded_detail(daily_limit),
        )


async def _record_external_api_call_usage(
    conn: aiosqlite.Connection,
    *,
    request: Request,
    actor: AuthenticatedActor,
) -> None:
    """Record one successful external API call without counting app-server traffic."""
    if actor.auth_type not in _EXTERNAL_API_AUTH_TYPES or actor.org_id is None:
        return
    if getattr(request.state, _API_USAGE_RECORDED_STATE_KEY, False):
        return

    setattr(request.state, _API_USAGE_RECORDED_STATE_KEY, True)
    metadata = {
        "auth_type": actor.auth_type,
        "method": request.method,
        "surface": "api",
    }
    if actor.api_key_id is not None:
        metadata["api_key_id"] = actor.api_key_id

    await OrgUsageEventCRUD.record(
        conn,
        OrgUsageEventRecord(
            org_id=actor.org_id,
            actor_id=actor.user_id,
            event_type="api_call",
            resource_type="api",
            resource_id=_route_usage_resource_id(request),
            metadata_json=db_util.encode_json(metadata),
        ),
    )


def _authenticated_actor_from_api_key_principal(principal: ApiKeyPrincipal) -> AuthenticatedActor:
    """Build the request actor represented by a verified API key."""
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
        active_products=principal.active_products or [],
        resolved_capabilities=resolve_capabilities(principal.active_products or []),
    )


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

    cached_api_key_principal = api_key_principal_from_state(request)
    if cached_api_key_principal is not None:
        return _authenticated_actor_from_api_key_principal(cached_api_key_principal)

    if x_api_key:
        principal = await verify_api_key(x_api_key, settings)
        if principal is not None:
            return _authenticated_actor_from_api_key_principal(principal)

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
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={
            "WWW-Authenticate": build_bearer_challenge(settings),
        },
    )


def require_actor_permission(
    resource: str,
    action: str,
) -> Callable[..., AsyncGenerator[AuthenticatedActor, None]]:
    """Create a dependency that enforces an actor permission."""

    async def dependency(
        request: Request,
        actor: AuthenticatedActor = Depends(require_actor),
        settings: Settings = Depends(get_settings),
        usage_db: aiosqlite.Connection = Depends(get_usage_db),
    ) -> AsyncGenerator[AuthenticatedActor, None]:
        permitted_actor = require_permission(actor, resource, action, settings=settings)
        await _enforce_external_api_call_quota(usage_db, permitted_actor)
        yield permitted_actor
        await _record_external_api_call_usage(
            usage_db,
            request=request,
            actor=permitted_actor,
        )

    return dependency


def require_org_actor_permission(
    resource: str,
    action: str,
) -> Callable[..., AsyncGenerator[AuthenticatedActor, None]]:
    """Create a dependency that enforces org context and a resource permission."""

    async def dependency(
        request: Request,
        actor: AuthenticatedActor = Depends(require_org_actor),
        settings: Settings = Depends(get_settings),
        usage_db: aiosqlite.Connection = Depends(get_usage_db),
    ) -> AsyncGenerator[AuthenticatedActor, None]:
        permitted_actor = require_permission(actor, resource, action, settings=settings)
        await _enforce_external_api_call_quota(usage_db, permitted_actor)
        yield permitted_actor
        await _record_external_api_call_usage(
            usage_db,
            request=request,
            actor=permitted_actor,
        )

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
        if actor.is_local:
            actor.org_role = "owner"
            actor.org_slug = actor.org_id
            actor.workspace_type = "individual"
            actor.active_products = ["atlas_team"]
        else:
            actor.active_products = actor.active_products or []
        actor.resolved_capabilities = resolve_capabilities(actor.active_products)
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
