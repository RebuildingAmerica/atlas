"""Tests for MCP server registration and shared app wiring."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from atlas.config import Settings
from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.server import build_mcp, get_mcp, get_mcp_asgi_app
from tests.support.mcp_server import (
    EXPECTED_ASGI_APP_MIDDLEWARE_COUNT,
    EXPECTED_TOOL_NAMES,
)


@pytest.mark.asyncio
async def test_build_mcp_registers_all_atlas_tools() -> None:
    """build_mcp() registers the expected Atlas MCP surface."""
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


def test_get_mcp_asgi_app_installs_middleware_once(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    """Repeated app access does not re-stack middleware."""
    app = MagicMock()
    app.state = SimpleNamespace()
    mcp = MagicMock()
    mcp.streamable_http_app.return_value = app

    with patch.object(server_module, "get_mcp", return_value=mcp):
        first = get_mcp_asgi_app()
        second = get_mcp_asgi_app()

    assert first is app
    assert second is app
    assert app.add_middleware.call_count == EXPECTED_ASGI_APP_MIDDLEWARE_COUNT
