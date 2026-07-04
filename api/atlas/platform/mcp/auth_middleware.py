"""Bearer JWT middleware for the MCP Streamable HTTP transport."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from atlas.domains.access.challenges import build_bearer_challenge
from atlas.domains.access.jwt import verify_bearer_jwt
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.platform.config import get_settings
from atlas.platform.database import db as db_util
from atlas.platform.database import get_db_connection

if TYPE_CHECKING:
    from starlette.requests import Request

    from atlas.platform.config import Settings

RequestResponseEndpoint = Callable[["Request"], Awaitable[Response]]
DISCOVERY_READ_SCOPE = "discovery:read"
MCP_CAPABILITY_SCOPE = "api.mcp"
REQUIRED_MCP_SCOPES = (DISCOVERY_READ_SCOPE, MCP_CAPABILITY_SCOPE)
STATUS_CLIENT_ERROR_MIN = 400
logger = logging.getLogger(__name__)


def _has_discovery_read_scope(payload: object) -> bool:
    """Return whether a verified access-token payload allows MCP read tools."""
    if not isinstance(payload, dict):
        return False

    permissions = payload.get("permissions")
    if isinstance(permissions, dict):
        discovery_permissions = permissions.get("discovery")
        if isinstance(discovery_permissions, list) and "read" in discovery_permissions:
            return True

    scope = payload.get("scope")
    if isinstance(scope, str) and DISCOVERY_READ_SCOPE in scope.split():
        return True
    if isinstance(scope, list) and DISCOVERY_READ_SCOPE in scope:
        return True

    scopes = payload.get("scopes")
    return isinstance(scopes, list) and DISCOVERY_READ_SCOPE in scopes


def _has_mcp_package_access(payload: object) -> bool:
    """Return whether Atlas granted the token MCP package access."""
    if not isinstance(payload, dict):
        return False

    capabilities = payload.get("capabilities")
    return isinstance(capabilities, list) and MCP_CAPABILITY_SCOPE in capabilities


def _string_claim(payload: object, key: str) -> str | None:
    """Return a non-empty string claim from a verified JWT payload."""
    if not isinstance(payload, dict):
        return None

    value = payload.get(key)
    if not isinstance(value, str) or not value:
        return None
    return value


def _response_succeeded(response: object) -> bool:
    """Return whether an MCP response should count as successful usage."""
    status_code = getattr(response, "status_code", None)
    return isinstance(status_code, int) and status_code < STATUS_CLIENT_ERROR_MIN


async def _record_successful_mcp_usage(
    settings: Settings,
    *,
    payload: object,
    request: Request,
    response: object,
) -> None:
    """Record a successful MCP request as customer-visible integration usage."""
    if not _response_succeeded(response):
        return

    org_id = _string_claim(payload, "org_id")
    if org_id is None:
        return

    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        await OrgUsageEventCRUD.record(
            conn,
            OrgUsageEventRecord(
                org_id=org_id,
                actor_id=_string_claim(payload, "sub"),
                event_type="api_call",
                resource_type="api",
                resource_id=request.url.path,
                metadata_json=db_util.encode_json(
                    {
                        "auth_type": "oauth_jwt",
                        "method": request.method,
                        "surface": "mcp",
                    }
                ),
            ),
        )
    finally:
        await conn.close()


class McpBearerAuthMiddleware(BaseHTTPMiddleware):
    """Rejects MCP requests that lack a valid OAuth 2.1 JWT bearer token.

    When auth is disabled (no audience configured), all requests pass through.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        if not settings.auth_jwt_audience:
            return await call_next(request)

        authorization = request.headers.get("authorization")
        payload = verify_bearer_jwt(
            authorization,
            issuer=settings.auth_jwt_issuer,
            audience=[settings.auth_jwt_resource_url],
            jwks_url=settings.auth_jwt_jwks_url,
        )
        if payload is None:
            return Response(
                status_code=401,
                headers={
                    "WWW-Authenticate": build_bearer_challenge(
                        settings,
                        scope=REQUIRED_MCP_SCOPES,
                    ),
                },
            )

        if not _has_discovery_read_scope(payload):
            return Response(
                status_code=403,
                headers={
                    "WWW-Authenticate": build_bearer_challenge(
                        settings,
                        scope=[DISCOVERY_READ_SCOPE],
                        error="insufficient_scope",
                        error_description="Atlas MCP requires discovery:read.",
                    ),
                },
            )

        if not _has_mcp_package_access(payload):
            return Response(
                status_code=403,
                headers={
                    "WWW-Authenticate": build_bearer_challenge(
                        settings,
                        scope=[MCP_CAPABILITY_SCOPE],
                        error="insufficient_scope",
                        error_description="Atlas MCP requires API/MCP package access.",
                    ),
                },
            )

        response = await call_next(request)
        try:
            await _record_successful_mcp_usage(
                settings,
                payload=payload,
                request=request,
                response=response,
            )
        except Exception:
            logger.exception("Failed to record MCP usage event.")
        return response
