"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest

from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.server import (
    build_mcp,
)
from tests.support.mcp_server import (
    FakeBrokenRequestContext,
    FakeMissingRequestContext,
    FakeUrlContext,
    _url_elicitation_meta,
)

if TYPE_CHECKING:
    from atlas.config import Settings


@pytest.mark.asyncio
async def test_scout_sync_schema() -> None:
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "sync_scout_artifacts")
    properties = tool.inputSchema.get("properties", {})
    assert {"artifacts"} <= set(properties)
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_scout_sync_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "synced", "run_id": "run_1"}
    artifacts = {
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
    }
    with patch.object(
        server_module,
        "sync_scout_artifacts_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool("sync_scout_artifacts", {"artifacts": artifacts})

    assert payload == expected
    handoff_mock.assert_awaited_once()
    routed_artifacts = handoff_mock.await_args.kwargs["artifacts"]
    assert routed_artifacts.manifest.runner == "atlas-scout"
    assert routed_artifacts.manifest.sync.local_run_id == "local_1"


@pytest.mark.asyncio
async def test_watch_schema() -> None:
    """Workspace watch helper exposes typed resource and notification choices."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "watch_workspace_resource")
    properties = tool.inputSchema.get("properties", {})
    assert {"resource_type", "resource_id", "notification_preference"} <= set(properties)
    assert properties["resource_type"]["enum"] == ["entry", "coverage_target"]
    assert properties["notification_preference"]["enum"] == ["digest", "immediate", "muted"]
    assert "ctx" not in properties


@pytest.mark.asyncio
async def test_watch_routes(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    expected = {"status": "watched", "watch_id": "watch_1"}
    with patch.object(
        server_module,
        "watch_workspace_resource_handoff",
        new=AsyncMock(return_value=expected),
    ) as handoff_mock:
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "watch_workspace_resource",
            {
                "resource_type": "entry",
                "resource_id": "entry_1",
                "notification_preference": "immediate",
            },
        )

    assert payload == expected
    handoff_mock.assert_awaited_once()
    assert handoff_mock.await_args.kwargs == {
        "resource_type": "entry",
        "resource_id": "entry_1",
        "notification_preference": "immediate",
    }


@pytest.mark.asyncio
async def test_billing_needs_url_capability(
    patched_settings: Settings,
) -> None:
    """Atlas should not try URL mode when the client did not declare support."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=FakeUrlContext(action="accept"),
        settings=patched_settings,
    )

    assert result == {
        "status": "unsupported",
        "message": "Open Atlas account settings to manage billing.",
        "path": "/account",
    }


def test_context_helpers_tolerate_missing_request_state() -> None:
    assert server_module._actor_claims_from_context(None) == (None, None)  # noqa: SLF001
    assert server_module._actor_claims_from_context(FakeBrokenRequestContext()) == (  # noqa: SLF001
        None,
        None,
    )
    assert server_module._actor_claims_from_context(FakeMissingRequestContext()) == (  # noqa: SLF001
        None,
        None,
    )
    assert server_module._request_context_and_meta(FakeBrokenRequestContext()) == (  # noqa: SLF001
        None,
        None,
    )


@pytest.mark.asyncio
async def test_api_key_settings_unavailable_without_public_origin(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = ""

    result = await server_module._require_api_key_settings_url(  # noqa: SLF001
        ctx=FakeUrlContext(action="accept", meta=_url_elicitation_meta()),
        settings=patched_settings,
    )

    assert result == {
        "status": "unavailable",
        "message": "Atlas account settings are unavailable right now.",
    }
