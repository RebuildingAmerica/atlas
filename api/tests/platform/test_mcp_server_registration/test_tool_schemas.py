"""Tests for MCP tool schemas and context hiding."""

from __future__ import annotations

import pytest

from atlas.platform.mcp.server import build_mcp


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
async def test_coverage_target_schema() -> None:
    """Coverage target helper exposes workspace target fields, not injected context."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "create_coverage_target")
    properties = tool.inputSchema.get("properties", {})
    assert {
        "name",
        "geography",
        "issue_areas",
        "actor_types",
        "source_types",
        "linked_discovery_run_ids",
        "linked_entry_ids",
        "gaps",
        "next_actions",
    } <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_brief_schema() -> None:
    """Research brief helper exposes only user-supplied fields."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "create_research_brief")
    properties = tool.inputSchema.get("properties", {})
    assert {
        "title",
        "scope",
        "summary",
        "linked_entry_ids",
        "linked_source_ids",
        "linked_discovery_run_ids",
        "confidence_summary",
        "gaps",
    } <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_export_brief_schema() -> None:
    """Exporting a research brief should only accept the brief id."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "export_research_brief")
    properties = tool.inputSchema.get("properties", {})
    assert {"brief_id"} <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_export_report_schema() -> None:
    """Coverage report export should not expose injected context."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "export_coverage_report")
    properties = tool.inputSchema.get("properties", {})
    assert "ctx" not in properties
    assert properties == {}
