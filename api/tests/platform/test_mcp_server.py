"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from atlas.platform.mcp.server import build_mcp, get_mcp

HTTP_UNAUTHORIZED = 401

EXPECTED_TOOL_NAMES = {
    "search_entities",
    "get_entity",
    "get_entity_sources",
    "search_sources",
    "get_place_entities",
    "get_place_profile",
    "get_place_coverage",
    "get_place_issue_signals",
    "get_related_entities",
    "resolve_issue_areas",
}


@pytest.mark.asyncio
async def test_build_mcp_registers_all_atlas_read_tools() -> None:
    """build_mcp() registers exactly the read-only Atlas tool surface."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool_names = {tool.name for tool in tools}
    assert tool_names == EXPECTED_TOOL_NAMES


@pytest.mark.asyncio
async def test_build_mcp_excludes_write_tools() -> None:
    """Flag-creation methods are intentionally not exposed via MCP."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool_names = {tool.name for tool in tools}
    assert "create_entity_flag" not in tool_names
    assert "create_source_flag" not in tool_names


@pytest.mark.asyncio
async def test_get_mcp_returns_singleton() -> None:
    """get_mcp() caches the FastMCP instance across calls."""
    first = get_mcp()
    second = get_mcp()
    assert first is second


@pytest.mark.asyncio
async def test_search_entities_tool_has_expected_schema() -> None:
    """The search_entities tool exposes the expected input parameters."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "search_entities")
    properties = tool.inputSchema.get("properties", {})
    expected = {"place", "issue_areas", "text", "entity_types", "source_types", "limit", "cursor"}
    assert expected <= set(properties)


@pytest.mark.asyncio
async def test_auth_middleware_passes_through_when_audience_unset() -> None:
    """When auth_jwt_audience is empty (deploy_mode=local), JWT verification is skipped."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {}
    next_handler = AsyncMock(return_value="ok")

    with patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock:
        settings = MagicMock()
        settings.auth_jwt_audience = []
        get_settings_mock.return_value = settings

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)


@pytest.mark.asyncio
async def test_auth_middleware_returns_401_with_resource_metadata_challenge() -> None:
    """Unauthenticated requests receive 401 with WWW-Authenticate per RFC 6750 §3.

    The challenge advertises the protected-resource metadata URL so MCP clients
    can discover the OAuth issuer automatically.
    """
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer not-a-real-token"}
    next_handler = AsyncMock()

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com"
        settings.auth_resource_metadata_url = (
            "https://atlas.example.com/.well-known/oauth-protected-resource"
        )
        settings.auth_jwt_default_scope = []
        get_settings_mock.return_value = settings
        verify_mock.return_value = None

        response = await middleware.dispatch(request, next_handler)

    assert response.status_code == HTTP_UNAUTHORIZED
    challenge = response.headers["WWW-Authenticate"]
    assert challenge.startswith("Bearer ")
    assert (
        'resource_metadata="https://atlas.example.com/.well-known/oauth-protected-resource"'
        in challenge
    )
    next_handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_auth_middleware_lets_through_valid_token() -> None:
    """A request with a valid bearer JWT reaches the wrapped app."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    next_handler = AsyncMock(return_value="ok")

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {"sub": "user-123", "aud": "https://atlas.example.com"}

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)
