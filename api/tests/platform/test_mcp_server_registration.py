"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.server import (
    build_mcp,
    get_mcp,
    get_mcp_asgi_app,
)
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "arguments"),
    [
        (
            "create_coverage_target",
            {
                "name": "Kansas City tenant power",
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
            },
        ),
        (
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed lead is ready for review.",
            },
        ),
        ("export_research_brief", {"brief_id": "brief_1"}),
        ("export_coverage_report", {}),
        (
            "sync_scout_artifacts",
            {
                "artifacts": {
                    "manifest": {
                        "runner": "atlas-scout",
                        "run": {
                            "location_query": "Wichita, KS",
                            "state": "KS",
                            "issue_areas": ["worker_cooperatives"],
                        },
                        "status": "completed",
                        "sync": {"local_run_id": "local_1", "sync_status": "ready"},
                    },
                    "stats": {},
                    "sources": [],
                    "ranked_entries": [],
                },
            },
        ),
        (
            "watch_workspace_resource",
            {
                "resource_type": "entry",
                "resource_id": "entry_1",
                "notification_preference": "immediate",
            },
        ),
    ],
)
async def test_handoff_flag_blocks_every_workbench_write_tool(
    patched_settings: Settings,
    tool_name: str,
    arguments: dict[str, object],
) -> None:
    """The Workbench rollback flag should disable every write handoff uniformly."""
    patched_settings.mcp_workbench_handoffs_enabled = False
    mcp = build_mcp()

    _content, payload = await mcp.call_tool(tool_name, arguments)

    assert payload == {
        "status": "disabled",
        "message": "MCP Workbench handoffs are disabled.",
    }


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
async def test_coverage_target_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "created", "target_id": "target_1"}
    with patch.object(
        server_module,
        "create_coverage_target_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "create_coverage_target",
            {
                "name": "Kansas City tenant power",
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
                "linked_entry_ids": ["entry_1"],
            },
        )

    assert payload == expected
    handoff_mock.assert_awaited_once()
    assert handoff_mock.await_args.kwargs == {
        "name": "Kansas City tenant power",
        "geography": "Kansas City, MO",
        "issue_areas": ["housing_affordability"],
        "actor_types": ["organization"],
        "source_types": ["community_archive"],
        "linked_discovery_run_ids": None,
        "linked_entry_ids": ["entry_1"],
        "gaps": None,
        "next_actions": None,
    }


@pytest.mark.asyncio
async def test_brief_schema() -> None:
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
async def test_brief_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "created", "brief_id": "brief_1"}
    with patch.object(
        server_module,
        "create_research_brief_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed lead is ready for review.",
                "linked_entry_ids": ["entry_1"],
            },
        )

    assert payload == expected
    handoff_mock.assert_awaited_once()
    assert handoff_mock.await_args.kwargs == {
        "title": "Kansas City housing brief",
        "scope": {"geography": "Kansas City, MO"},
        "summary": "One source-backed lead is ready for review.",
        "linked_entry_ids": ["entry_1"],
        "linked_source_ids": None,
        "linked_discovery_run_ids": None,
        "confidence_summary": None,
        "gaps": None,
    }


@pytest.mark.asyncio
async def test_export_brief_schema() -> None:
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "export_research_brief")
    properties = tool.inputSchema.get("properties", {})
    assert {"brief_id"} <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_export_brief_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "exported", "brief": {"id": "brief_1"}}
    with patch.object(
        server_module,
        "export_research_brief_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "export_research_brief",
            {"brief_id": "brief_1"},
        )

    assert payload == expected
    handoff_mock.assert_awaited_once()
    assert handoff_mock.await_args.kwargs == {"brief_id": "brief_1"}


@pytest.mark.asyncio
async def test_export_report_schema() -> None:
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "export_coverage_report")
    properties = tool.inputSchema.get("properties", {})
    assert "ctx" not in properties
    assert properties == {}


@pytest.mark.asyncio
async def test_export_report_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "exported", "report": {"org_id": "org_1"}}
    with patch.object(
        server_module,
        "export_coverage_report_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool("export_coverage_report", {})

    assert payload == expected
    handoff_mock.assert_awaited_once()
    assert handoff_mock.await_args.kwargs == {}
