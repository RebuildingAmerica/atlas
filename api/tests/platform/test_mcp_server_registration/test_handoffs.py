"""Tests for MCP write handoffs and routing."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from atlas.config import Settings
from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.server import build_mcp


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
