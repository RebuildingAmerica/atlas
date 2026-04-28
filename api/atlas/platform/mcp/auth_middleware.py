"""Bearer JWT middleware for the MCP Streamable HTTP transport."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from atlas.domains.access.challenges import build_bearer_challenge
from atlas.domains.access.jwt import verify_bearer_jwt
from atlas.platform.config import get_settings

if TYPE_CHECKING:
    from starlette.requests import Request

RequestResponseEndpoint = Callable[["Request"], Awaitable[Response]]


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
            audience=settings.auth_jwt_audience,
            jwks_url=settings.auth_jwt_jwks_url,
        )
        if payload is None:
            return Response(
                status_code=401,
                headers={
                    "WWW-Authenticate": build_bearer_challenge(settings),
                },
            )

        return await call_next(request)
