"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from tests.support.mcp_server import (
    HTTP_FORBIDDEN,
)


@pytest.mark.asyncio
async def test_auth_middleware_ignores_non_tools_call_methods() -> None:
    """A JSON-RPC method other than tools/call never requires discovery:write."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.json = AsyncMock(return_value={"method": "tools/list", "params": {}})
    next_handler = AsyncMock(return_value="ok")

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com/mcp"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com/mcp"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "capabilities": ["api.mcp"],
            "permissions": {"discovery": ["read"]},
        }

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)


@pytest.mark.asyncio
async def test_auth_middleware_ignores_tools_call_with_malformed_params() -> None:
    """A tools/call body with non-dict params never requires discovery:write."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.json = AsyncMock(return_value={"method": "tools/call", "params": "not-a-dict"})
    next_handler = AsyncMock(return_value="ok")

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com/mcp"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com/mcp"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "capabilities": ["api.mcp"],
            "permissions": {"discovery": ["read"]},
        }

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)


@pytest.mark.asyncio
async def test_auth_middleware_rejects_start_discovery_run_without_write_scope() -> None:
    """Triggering a discovery run over MCP requires discovery:write, not just read."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.json = AsyncMock(
        return_value={"method": "tools/call", "params": {"name": "start_discovery_run"}}
    )
    next_handler = AsyncMock(return_value="ok")

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com/mcp"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com/mcp"
        settings.auth_resource_metadata_url = (
            "https://atlas.example.com/.well-known/oauth-protected-resource/mcp"
        )
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "capabilities": ["api.mcp"],
            "permissions": {"discovery": ["read"]},
        }

        response = await middleware.dispatch(request, next_handler)

    assert response.status_code == HTTP_FORBIDDEN
    challenge = response.headers["WWW-Authenticate"]
    assert 'error="insufficient_scope"' in challenge
    assert 'scope="discovery:write"' in challenge
    next_handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_auth_middleware_allows_start_discovery_run_with_write_scope() -> None:
    """A token with discovery:write may call the start_discovery_run tool."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.json = AsyncMock(
        return_value={"method": "tools/call", "params": {"name": "start_discovery_run"}}
    )
    next_handler = AsyncMock(return_value="ok")

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com/mcp"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com/mcp"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "capabilities": ["api.mcp"],
            "permissions": {"discovery": ["read", "write"]},
        }

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)


@pytest.mark.asyncio
async def test_auth_middleware_verifies_only_the_mcp_resource_audience() -> None:
    """MCP requests must not accept tokens minted for a sibling REST API resource."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    next_handler = AsyncMock(return_value="ok")

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = [
            "https://atlas.example.com/mcp",
            "https://api.atlas.example.com",
        ]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com/mcp"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "capabilities": ["api.mcp"],
            "permissions": {"discovery": ["read"]},
        }

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    verify_mock.assert_called_once_with(
        "Bearer valid-token",
        issuer="https://atlas.example.com/api/auth",
        audience=["https://atlas.example.com/mcp"],
        jwks_url="https://atlas.example.com/api/auth/jwks",
    )
    next_handler.assert_awaited_once_with(request)
