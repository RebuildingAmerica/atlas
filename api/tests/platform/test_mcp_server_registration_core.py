"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.server import build_mcp, get_mcp, get_mcp_asgi_app
from tests.support.mcp_server import (
    EXPECTED_ASGI_APP_MIDDLEWARE_COUNT,
    EXPECTED_TOOL_NAMES,
)

if TYPE_CHECKING:
    from atlas.config import Settings


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


def test_get_mcp_asgi_app_installs_middleware_once(patched_settings: Settings) -> None:  # noqa: ARG001
    """Repeated app access does not re-stack draft-Tasks, auth, or CORS middleware."""
    app = MagicMock()
    app.state = SimpleNamespace()
    mcp = MagicMock()
    mcp.streamable_http_app.return_value = app

    with patch.object(server_module, "get_mcp", return_value=mcp):
        first = get_mcp_asgi_app()
        second = get_mcp_asgi_app()

    assert first is app
    assert second is app
    # First call installs draft-Tasks, auth, and CORS; the second call must
    # add none of them again.
    assert app.add_middleware.call_count == EXPECTED_ASGI_APP_MIDDLEWARE_COUNT


@pytest.mark.asyncio
async def test_search_entities_tool_has_expected_schema() -> None:
    """The search_entities tool exposes the expected input parameters."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "search_entities")
    properties = tool.inputSchema.get("properties", {})
    expected = {"place", "issue_areas", "text", "entity_types", "source_types", "limit", "cursor"}
    assert expected <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_place_tools_hide_context() -> None:
    """Injected FastMCP context should not appear as user-editable tool input."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool_names = {
        "get_place_entities",
        "get_place_profile",
        "get_place_coverage",
        "get_place_issue_signals",
    }

    for tool in tools:
        if tool.name in tool_names:
            assert "ctx" not in tool.inputSchema.get("properties", {})


@pytest.mark.asyncio
async def test_billing_tool_hides_context() -> None:
    """URL-mode billing helper should not expose FastMCP context as tool input."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "open_billing_settings")
    assert tool.inputSchema.get("properties", {}) == {}


@pytest.mark.asyncio
async def test_issue_tool_hides_context() -> None:
    """Injected FastMCP context should not appear on resolve_issue_areas."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "resolve_issue_areas")
    assert "ctx" not in tool.inputSchema.get("properties", {})


@pytest.mark.asyncio
async def test_save_list_schema() -> None:
    """Workbench write helper exposes only user-supplied fields."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "save_entities_to_list")
    properties = tool.inputSchema.get("properties", {})
    assert {"list_id", "entry_ids", "note"} <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_save_list_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "saved", "saved_count": 1}
    with patch.object(
        server_module,
        "save_entities_to_list_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "save_entities_to_list",
            {"list_id": "list_1", "entry_ids": ["entry_1"], "note": "follow up"},
        )

    assert payload == expected
    handoff_mock.assert_awaited_once()
    assert handoff_mock.await_args.kwargs == {
        "list_id": "list_1",
        "entry_ids": ["entry_1"],
        "note": "follow up",
    }


@pytest.mark.asyncio
async def test_handoff_flag_blocks_save(
    patched_settings: Settings,
) -> None:
    patched_settings.mcp_workbench_handoffs_enabled = False
    with patch.object(
        server_module,
        "save_entities_to_list_handoff",
        new=AsyncMock(return_value={"status": "saved"}),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "save_entities_to_list",
            {"list_id": "list_1", "entry_ids": ["entry_1"]},
        )

    assert payload == {
        "status": "disabled",
        "message": "MCP Workbench handoffs are disabled.",
    }
    handoff_mock.assert_not_awaited()
