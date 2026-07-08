"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import httpx
import pytest
from starlette.middleware.cors import CORSMiddleware

from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from atlas.platform.mcp.server import (
    get_mcp_asgi_app,
    split_cors_origins,
)
from tests.support.mcp_server import (
    HTTP_OK,
)

if TYPE_CHECKING:
    from atlas.config import Settings


@pytest.mark.asyncio
async def test_get_mcp_asgi_app_returns_mountable_app(patched_settings: Settings) -> None:  # noqa: ARG001
    """`get_mcp_asgi_app` should return the Starlette streamable_http_app."""
    app = get_mcp_asgi_app()
    assert callable(app)


class TestSplitCorsOrigins:
    """`split_cors_origins` bridges FastMCP's `:*` wildcard convention to Starlette."""

    def test_passes_through_exact_origins_unchanged(self) -> None:
        exact_origins, origin_regex = split_cors_origins(["https://atlas.rebuildingus.org"])
        assert exact_origins == ["https://atlas.rebuildingus.org"]
        assert origin_regex is None

    def test_converts_wildcard_port_origins_to_a_regex(self) -> None:
        exact_origins, origin_regex = split_cors_origins(
            ["http://127.0.0.1:*", "http://localhost:*"]
        )
        assert exact_origins == []
        assert origin_regex is not None

        pattern = re.compile(origin_regex)
        assert pattern.fullmatch("http://127.0.0.1:5173")
        assert pattern.fullmatch("http://localhost:3000")
        assert not pattern.fullmatch("https://evil.example.com")

    def test_splits_a_mixed_allowlist(self) -> None:
        exact_origins, origin_regex = split_cors_origins(
            ["https://atlas.rebuildingus.org", "http://127.0.0.1:*"]
        )
        assert exact_origins == ["https://atlas.rebuildingus.org"]
        assert origin_regex is not None
        assert re.compile(origin_regex).fullmatch("http://127.0.0.1:9999")


@pytest.mark.asyncio
async def test_get_mcp_asgi_app_puts_cors_outside_the_auth_guard(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    """CORSMiddleware must wrap McpBearerAuthMiddleware, not the reverse.

    An unauthenticated preflight `OPTIONS` request never carries a bearer
    token, so if the auth guard ran first it would reject the preflight
    with 401 before `CORSMiddleware` ever got a chance to answer it —
    exactly the failure this ordering avoids.
    """
    app = get_mcp_asgi_app()
    middleware_classes = [entry.cls for entry in app.user_middleware]

    cors_index = middleware_classes.index(CORSMiddleware)
    auth_index = middleware_classes.index(McpBearerAuthMiddleware)
    assert cors_index < auth_index, "CORSMiddleware must be outermost (added last)"


@pytest.mark.asyncio
async def test_get_mcp_asgi_app_answers_local_wildcard_preflight(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    """A preflight from a local dev origin on an arbitrary port should succeed.

    `test_settings` only configures `http://localhost:3000` as an exact CORS
    origin; a different local port (`http://127.0.0.1:54321`) only matches via
    the wildcard regex `split_cors_origins` derives from `LOCAL_ALLOWED_ORIGINS`.
    """
    app = get_mcp_asgi_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/",
            headers={
                "Origin": "http://127.0.0.1:54321",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.status_code == HTTP_OK
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:54321"
