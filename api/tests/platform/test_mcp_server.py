"""Tests for the FastMCP server module and bearer-auth middleware."""
# ruff: noqa

from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlsplit
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from mcp.shared.exceptions import McpError
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import Response

from atlas.config import Settings
from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from atlas.platform.mcp.elicitation import (
    CLIENT_CAPABILITIES_META_KEY,
    URL_ELICITATION_REQUIRED,
    complete_url_elicitation_state,
    get_url_elicitation_state,
)
from atlas.platform.mcp.server import (
    build_mcp,
    get_mcp,
    get_mcp_asgi_app,
    mcp_session_lifespan,
    split_cors_origins,
)
from atlas.platform.mcp.widgets import (
    CONNECTIONS_GRAPH_RESOURCE_URI,
    ENTITY_CARD_RESOURCE_URI,
    SEARCH_RESULTS_RESOURCE_URI,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_OK = 200
EXPECTED_ASGI_APP_MIDDLEWARE_COUNT = 3  # draft-Tasks, auth, CORS

EXPECTED_TOOL_NAMES = {
    "create_coverage_target",
    "create_research_brief",
    "export_coverage_report",
    "export_research_brief",
    "get_discovery_run",
    "search_entities",
    "get_entity",
    "get_entity_sources",
    "list_discovery_runs",
    "search_sources",
    "get_place_entities",
    "get_place_profile",
    "get_place_coverage",
    "get_place_issue_signals",
    "get_related_entities",
    "open_api_key_settings",
    "open_billing_settings",
    "require_api_key_settings",
    "resolve_issue_areas",
    "save_entities_to_list",
    "start_discovery_run",
    "sync_scout_artifacts",
    "watch_workspace_resource",
}


class FakeUrlContext:
    def __init__(self, *, action: str, meta: dict[str, object] | None = None) -> None:
        self.actions: list[dict[str, str]] = []
        self.session = SimpleNamespace(send_elicit_complete=AsyncMock())
        self.request_context = SimpleNamespace(
            meta=meta,
            session=self.session,
            request=SimpleNamespace(
                state=SimpleNamespace(mcp_auth_payload={"org_id": "org_1", "sub": "user_1"})
            ),
        )
        self._action = action

    async def elicit_url(self, *, message: str, url: str, elicitation_id: str) -> object:
        self.actions.append({"message": message, "url": url, "elicitation_id": elicitation_id})
        return SimpleNamespace(action=self._action)


class FakeBrokenRequestContext:
    @property
    def request_context(self) -> object:
        raise ValueError


class FakeMissingRequestContext:
    request_context = SimpleNamespace(request=None, meta={"ok": True})


def _url_elicitation_meta() -> dict[str, object]:
    return {CLIENT_CAPABILITIES_META_KEY: {"elicitation": {"url": {}}}}


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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "helper_name"),
    [
        ("open_billing_settings", "_open_billing_settings_url"),
        ("open_api_key_settings", "_open_api_key_settings_url"),
        ("require_api_key_settings", "_require_api_key_settings_url"),
    ],
)
async def test_account_settings_tools_delegate_to_url_helpers(
    tool_name: str,
    helper_name: str,
) -> None:
    helper = AsyncMock(return_value={"status": "delegated"})

    with patch.object(server_module, helper_name, helper):
        _content, payload = await build_mcp().call_tool(tool_name, {})

    assert payload == {"status": "delegated"}
    helper.assert_awaited_once()


@pytest.mark.asyncio
async def test_url_elicitation_flag_blocks_billing(
    patched_settings: Settings,
) -> None:
    """Operators can roll back URL-mode browser handoffs without URL prompts."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    patched_settings.mcp_url_elicitation_enabled = False
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "unsupported",
        "message": "Open Atlas account settings to manage billing.",
        "path": "/account",
    }
    assert ctx.actions == []


@pytest.mark.asyncio
async def test_account_url_unavailable_hides_config(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = ""

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=FakeUrlContext(action="accept", meta=_url_elicitation_meta()),
        settings=patched_settings,
    )

    assert result == {
        "status": "unavailable",
        "message": "Atlas account settings are unavailable right now.",
    }


@pytest.mark.asyncio
async def test_billing_uses_atlas_url(
    patched_settings: Settings,
) -> None:
    """URL mode should point at Atlas and bind server-side state to the MCP actor."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result["status"] == "accepted"
    elicitation_id = result["elicitation_id"]
    requested = ctx.actions[0]
    assert requested["url"] == (
        f"https://atlas.example.com/account?mcpElicitationId={elicitation_id}"
    )
    assert requested["elicitation_id"] == elicitation_id

    state = get_url_elicitation_state(elicitation_id)
    assert state is not None
    assert state.user_id == "user_1"
    assert state.org_id == "org_1"
    assert state.target_flow == "billing_settings"
    assert state.target_url == "/account"
    assert state.session is ctx.session


@pytest.mark.asyncio
async def test_smoke_url_client(patched_settings: Settings) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result["status"] == "accepted"
    assert ctx.actions[0]["message"] == "Open Atlas account settings to manage billing."
    assert ctx.actions[0]["url"].startswith("https://atlas.example.com/account?")


@pytest.mark.asyncio
async def test_billing_decline_not_opened(
    patched_settings: Settings,
) -> None:
    """Declined URL consent should be explicit and non-misleading."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="decline", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "decline",
        "message": "Atlas billing settings were not opened.",
    }


@pytest.mark.asyncio
async def test_api_key_settings_uses_atlas_url(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_api_key_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result["status"] == "accepted"
    elicitation_id = result["elicitation_id"]
    requested = ctx.actions[0]
    assert requested["url"] == (
        f"https://atlas.example.com/account?mcpElicitationId={elicitation_id}"
    )
    assert requested["elicitation_id"] == elicitation_id

    state = get_url_elicitation_state(elicitation_id)
    assert state is not None
    assert state.user_id == "user_1"
    assert state.org_id == "org_1"
    assert state.target_flow == "api_key_settings"
    assert state.target_url == "/account"
    assert state.session is ctx.session


@pytest.mark.asyncio
async def test_api_key_setup_requires_url_completion(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    with pytest.raises(McpError) as exc_info:
        await server_module._require_api_key_settings_url(  # noqa: SLF001
            ctx=ctx,
            settings=patched_settings,
        )

    error = exc_info.value.error
    assert error.code == URL_ELICITATION_REQUIRED
    assert error.message == "Atlas API key setup must be completed in the browser."
    assert error.data is not None
    elicitations = error.data["elicitations"]
    assert len(elicitations) == 1
    elicitation = elicitations[0]
    assert elicitation["mode"] == "url"
    assert elicitation["message"] == "Open Atlas account settings to manage API keys."
    url = urlsplit(elicitation["url"])
    query = parse_qs(url.query)
    assert url.scheme == "https"
    assert url.netloc == "atlas.example.com"
    assert url.path == "/account"
    assert set(query) == {"mcpElicitationId"}
    assert query["mcpElicitationId"] == [elicitation["elicitationId"]]
    assert "user_1" not in elicitation["url"]
    assert "org_1" not in elicitation["url"]

    state = get_url_elicitation_state(elicitation["elicitationId"])
    assert state is not None
    assert state.user_id == "user_1"
    assert state.org_id == "org_1"
    assert state.target_flow == "api_key_settings"
    assert state.target_url == "/account"


@pytest.mark.asyncio
async def test_api_key_setup_needs_url_capability(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept")

    result = await server_module._require_api_key_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "unsupported",
        "message": "Open Atlas account settings to manage API keys.",
        "path": "/account",
    }
    assert ctx.actions == []


@pytest.mark.asyncio
async def test_api_key_setup_retry_after_completion(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    state = server_module._create_account_elicitation_state(  # noqa: SLF001
        ctx=FakeUrlContext(action="accept", meta=_url_elicitation_meta()),
        target_flow="api_key_settings",
    )
    await complete_url_elicitation_state(
        state.elicitation_id,
        user_id="user_1",
        org_id="org_1",
    )
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._require_api_key_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "ready",
        "message": "Atlas API key settings are ready.",
        "path": "/account",
    }
    assert ctx.actions == []


@pytest.mark.asyncio
async def test_list_discovery_runs_tool_has_expected_schema() -> None:
    """The list_discovery_runs tool exposes filters agents need for research artifacts."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "list_discovery_runs")
    properties = tool.inputSchema.get("properties", {})
    expected = {"state", "status", "limit", "cursor"}
    assert expected <= set(properties)


@pytest.mark.asyncio
async def test_discovery_run_tools_delegate_to_the_data_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The MCP wrappers should forward run lookups to the shared data service."""

    class StubService:
        async def list_discovery_runs(self, **kwargs: object) -> dict[str, object]:
            return {"kwargs": kwargs}

        async def get_discovery_run(self, run_id: str) -> dict[str, str]:
            return {"run_id": run_id}

    monkeypatch.setattr(server_module, "_build_data_service", lambda: StubService())
    mcp = build_mcp()

    list_result = await mcp.call_tool(
        "list_discovery_runs",
        {"state": "MO", "limit": 1},
    )
    get_result = await mcp.call_tool("get_discovery_run", {"run_id": "run-1"})

    assert list_result[1] == {"kwargs": {"state": "MO", "status": None, "limit": 1, "cursor": None}}
    assert get_result[1] == {"run_id": "run-1"}


@pytest.mark.asyncio
async def test_get_entity_tool_has_widget_meta() -> None:
    """get_entity should associate the MCP Apps entity-card widget via _meta."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "get_entity")
    assert tool.meta == {"ui": {"resourceUri": ENTITY_CARD_RESOURCE_URI}}


@pytest.mark.asyncio
async def test_search_entities_tool_has_widget_meta() -> None:
    """search_entities should associate the MCP Apps search-results widget via _meta."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "search_entities")
    assert tool.meta == {"ui": {"resourceUri": SEARCH_RESULTS_RESOURCE_URI}}


@pytest.mark.asyncio
async def test_get_related_entities_tool_has_widget_meta() -> None:
    """get_related_entities should associate the MCP Apps connections-graph widget via _meta."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "get_related_entities")
    assert tool.meta == {"ui": {"resourceUri": CONNECTIONS_GRAPH_RESOURCE_URI}}


@pytest.mark.asyncio
async def test_only_three_widget_tools_have_widget_meta() -> None:
    """No other tool should have gained _meta as a side effect of this wiring."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    widget_tool_names = {"get_entity", "search_entities", "get_related_entities"}
    widget_tools = [tool for tool in tools if tool.name in widget_tool_names]
    other_tools = [tool for tool in tools if tool.name not in widget_tool_names]

    assert len(widget_tools) == len(widget_tool_names)
    for tool in widget_tools:
        assert tool.meta is not None

    assert other_tools  # sanity: there are other tools to check
    for tool in other_tools:
        assert tool.meta is None


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
    """A request with a valid bearer JWT and MCP package access reaches the wrapped app."""
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
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com",
            "capabilities": ["api.mcp"],
            "permissions": {"discovery": ["read"]},
        }

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)


@pytest.mark.asyncio
async def test_auth_middleware_records_successful_mcp_usage() -> None:
    """Successful MCP requests should count toward workspace integration activity."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.method = "POST"
    request.url.path = "/mcp"
    next_handler = AsyncMock(return_value=Response(status_code=200))
    conn = AsyncMock()

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
        patch(
            "atlas.platform.mcp.auth_middleware.get_db_connection",
            new_callable=AsyncMock,
        ) as db_mock,
        patch(
            "atlas.platform.mcp.auth_middleware.OrgUsageEventCRUD.record",
            new_callable=AsyncMock,
        ) as record_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com"
        settings.database_url = "sqlite:///atlas.db"
        settings.database_backend = "sqlite"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com",
            "capabilities": ["api.mcp"],
            "org_id": "org_mcp",
            "permissions": {"discovery": ["read"]},
        }
        db_mock.return_value = conn

        response = await middleware.dispatch(request, next_handler)

    assert response.status_code == HTTP_OK
    next_handler.assert_awaited_once_with(request)
    db_mock.assert_awaited_once_with("sqlite:///atlas.db", backend="sqlite")
    conn.close.assert_awaited_once()
    record_mock.assert_awaited_once()
    event_input = record_mock.await_args.args[1]
    assert event_input.org_id == "org_mcp"
    assert event_input.actor_id == "user-123"
    assert event_input.event_type == "api_call"
    assert event_input.resource_type == "api"
    assert event_input.resource_id == "/mcp"
    assert json.loads(event_input.metadata_json) == {
        "auth_type": "oauth_jwt",
        "method": "POST",
        "surface": "mcp",
    }


@pytest.mark.asyncio
async def test_auth_middleware_usage_write_failure_does_not_fail_successful_mcp_request() -> None:
    """A successful customer MCP response must not depend on telemetry durability."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.method = "POST"
    request.url.path = "/mcp"
    next_handler = AsyncMock(return_value=Response(status_code=HTTP_OK))
    conn = AsyncMock()

    with (
        patch("atlas.platform.mcp.auth_middleware.get_settings") as get_settings_mock,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt") as verify_mock,
        patch(
            "atlas.platform.mcp.auth_middleware.get_db_connection",
            new_callable=AsyncMock,
        ) as db_mock,
        patch(
            "atlas.platform.mcp.auth_middleware.OrgUsageEventCRUD.record",
            new_callable=AsyncMock,
        ) as record_mock,
    ):
        settings = MagicMock()
        settings.auth_jwt_audience = ["https://atlas.example.com"]
        settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
        settings.auth_jwt_jwks_url = "https://atlas.example.com/api/auth/jwks"
        settings.auth_jwt_resource_url = "https://atlas.example.com"
        settings.database_url = "sqlite:///atlas.db"
        settings.database_backend = "sqlite"
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com",
            "capabilities": ["api.mcp"],
            "org_id": "org_mcp",
            "permissions": {"discovery": ["read"]},
        }
        db_mock.return_value = conn
        record_mock.side_effect = RuntimeError("usage ledger unavailable")

        response = await middleware.dispatch(request, next_handler)

    assert response.status_code == HTTP_OK
    next_handler.assert_awaited_once_with(request)
    conn.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_auth_middleware_rejects_tokens_without_discovery_read_scope() -> None:
    """Valid MCP tokens still need discovery:read to list and call read tools."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
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
        settings.auth_jwt_default_scope = ["discovery:read"]
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "capabilities": ["api.mcp"],
            "permissions": {"entities": ["write"]},
        }

        response = await middleware.dispatch(request, next_handler)

    assert response.status_code == HTTP_FORBIDDEN
    challenge = response.headers["WWW-Authenticate"]
    assert 'error="insufficient_scope"' in challenge
    assert 'scope="discovery:read"' in challenge
    assert (
        'resource_metadata="https://atlas.example.com/.well-known/oauth-protected-resource/mcp"'
        in challenge
    )
    next_handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_auth_middleware_rejects_tokens_without_mcp_package_access() -> None:
    """Valid read tokens still need Atlas-derived MCP package access."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
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
        settings.auth_jwt_default_scope = ["discovery:read", "api.mcp"]
        get_settings_mock.return_value = settings
        verify_mock.return_value = {
            "sub": "user-123",
            "aud": "https://atlas.example.com/mcp",
            "permissions": {"discovery": ["read"]},
        }

        response = await middleware.dispatch(request, next_handler)

    assert response.status_code == HTTP_FORBIDDEN
    challenge = response.headers["WWW-Authenticate"]
    assert 'error="insufficient_scope"' in challenge
    assert 'scope="api.mcp"' in challenge
    assert (
        'resource_metadata="https://atlas.example.com/.well-known/oauth-protected-resource/mcp"'
        in challenge
    )
    next_handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_auth_middleware_allows_read_tool_call_without_discovery_write_scope() -> None:
    """A tools/call for a read tool never requires discovery:write."""
    middleware = McpBearerAuthMiddleware(app=AsyncMock())
    request = MagicMock()
    request.headers = {"authorization": "Bearer valid-token"}
    request.json = AsyncMock(
        return_value={"method": "tools/call", "params": {"name": "search_entities"}}
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
            "permissions": {"discovery": ["read"]},
        }

        result = await middleware.dispatch(request, next_handler)

    assert result == "ok"
    next_handler.assert_awaited_once_with(request)


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


# ---------------------------------------------------------------------------
# Tool callback execution coverage
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_settings(test_settings: Settings) -> Iterator[Settings]:
    """Patch `get_settings` inside the MCP server module to use the test DB."""
    with patch.object(server_module, "get_settings", return_value=test_settings):
        yield test_settings


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


def test_build_mcp_allows_configured_public_transport_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hosted MCP traffic should not inherit FastMCP's localhost-only host guard."""
    settings = Settings(
        database_url="sqlite:///tmp/test.db",
        environment="production",
        cors_origins=["https://atlas.rebuildingus.org", "*"],
        auth_jwt_issuer="https://atlas.rebuildingus.org",
        auth_jwt_audience=[
            "https://atlas.rebuildingus.org/mcp",
            "https://atlas-api.rebuildingus.org",
        ],
    )
    monkeypatch.setattr(server_module, "get_settings", lambda: settings)

    mcp = build_mcp()

    transport_security = mcp.settings.transport_security
    assert transport_security is not None
    assert transport_security.enable_dns_rebinding_protection is True
    assert "atlas.rebuildingus.org" in transport_security.allowed_hosts
    assert "atlas-api.rebuildingus.org" in transport_security.allowed_hosts
    assert "*" not in transport_security.allowed_hosts
    assert "https://atlas.rebuildingus.org" in transport_security.allowed_origins
    assert "*" not in transport_security.allowed_origins


@pytest.mark.asyncio
async def test_mcp_session_lifespan_yields_within_running_session_manager(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    """The lifespan context manager must enter and exit cleanly.

    Resets the FastMCP singleton so this test owns its own session manager
    instance. The MCP `StreamableHTTPSessionManager` permits exactly one
    `.run()` per instance; sharing the singleton with other lifespan tests
    triggers a "can only be called once" error.
    """
    original = server_module._mcp  # noqa: SLF001
    server_module._mcp = None  # noqa: SLF001
    try:
        # The streamable_http_app must be materialized first so that the
        # session manager is created lazily before lifespan tries to run it.
        get_mcp_asgi_app()
        async with mcp_session_lifespan():
            pass
    finally:
        server_module._mcp = original  # noqa: SLF001


@pytest.mark.asyncio
async def test_search_entities_tool_returns_collection(patched_settings: Settings) -> None:  # noqa: ARG001
    """The search_entities tool routes through AtlasDataService."""
    mcp = build_mcp()
    _content, payload = await mcp.call_tool("search_entities", {"limit": 5})
    assert "items" in payload
    assert "total" in payload


@pytest.mark.asyncio
async def test_get_entity_tool_raises_for_missing(patched_settings: Settings) -> None:  # noqa: ARG001
    """Missing entities surface as ValueError from the tool."""
    mcp = build_mcp()
    with pytest.raises(Exception, match="Entity not found"):
        await mcp.call_tool("get_entity", {"entity_id": "missing"})


@pytest.mark.asyncio
async def test_get_entity_sources_tool_raises_for_missing(patched_settings: Settings) -> None:  # noqa: ARG001
    mcp = build_mcp()
    with pytest.raises(Exception, match="Entity not found"):
        await mcp.call_tool("get_entity_sources", {"entity_id": "missing"})


@pytest.mark.asyncio
async def test_search_sources_tool_returns_collection(patched_settings: Settings) -> None:  # noqa: ARG001
    mcp = build_mcp()
    _content, payload = await mcp.call_tool("search_sources", {"limit": 5})
    assert "items" in payload


@pytest.mark.asyncio
async def test_get_place_entities_tool_returns_collection(patched_settings: Settings) -> None:  # noqa: ARG001
    mcp = build_mcp()
    _content, payload = await mcp.call_tool("get_place_entities", {"place": "Gary, IN", "limit": 5})
    assert "items" in payload


@pytest.mark.asyncio
async def test_place_entities_can_clarify(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    service = SimpleNamespace(search_entities=AsyncMock(return_value={"items": []}))
    clarified = {
        "place": "Detroit, MI",
        "issue_areas": None,
        "text": None,
        "entity_types": ["organization"],
        "source_types": None,
        "limit": 10,
        "cursor": None,
    }

    with (
        patch.object(server_module, "_build_data_service", return_value=service),
        patch.object(
            server_module,
            "clarify_search_entities_arguments",
            new=AsyncMock(return_value=clarified),
        ) as clarify_mock,
    ):
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "get_place_entities",
            {"place": "Detroit, MI", "limit": 20},
        )

    assert payload == {"items": []}
    assert clarify_mock.await_args.kwargs["allow_place_scoped_clarification"] is True
    service.search_entities.assert_awaited_once_with(**clarified)


@pytest.mark.asyncio
async def test_get_place_profile_tool_returns_seed(patched_settings: Settings) -> None:  # noqa: ARG001
    mcp = build_mcp()
    _content, payload = await mcp.call_tool("get_place_profile", {"place": "Gary, IN"})
    assert payload["place"]["display"] == "Gary, IN"


@pytest.mark.asyncio
async def test_get_place_coverage_tool_returns_summary(patched_settings: Settings) -> None:  # noqa: ARG001
    mcp = build_mcp()
    _content, payload = await mcp.call_tool("get_place_coverage", {"place": "Gary, IN"})
    assert "issue_counts" in payload


@pytest.mark.asyncio
async def test_get_place_issue_signals_tool_returns_payload(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    mcp = build_mcp()
    _content, payload = await mcp.call_tool(
        "get_place_issue_signals", {"place": "Gary, IN", "top_entities_per_issue": 1}
    )
    assert "issues" in payload


@pytest.mark.asyncio
async def test_get_related_entities_tool_raises_for_missing(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    mcp = build_mcp()
    with pytest.raises(Exception, match="Entity not found"):
        await mcp.call_tool("get_related_entities", {"entity_id": "missing"})


@pytest.mark.asyncio
async def test_resolve_issue_areas_tool_returns_matches(patched_settings: Settings) -> None:  # noqa: ARG001
    mcp = build_mcp()
    _content, payload = await mcp.call_tool(
        "resolve_issue_areas", {"text": "affordable housing", "limit": 3}
    )
    assert "items" in payload


@pytest.mark.asyncio
async def test_issue_tool_applies_matches(
    patched_settings: Settings,  # noqa: ARG001
) -> None:
    resolved = {
        "items": [
            {"slug": "housing_affordability", "name": "Housing", "match_score": 5},
            {
                "slug": "homelessness_and_housing_insecurity",
                "name": "Homelessness",
                "match_score": 4,
            },
        ],
        "total": 2,
        "next_cursor": None,
    }
    clarified = {**resolved, "items": [resolved["items"][1]], "total": 1}
    service = SimpleNamespace(resolve_issue_areas=AsyncMock(return_value=resolved))

    with (
        patch.object(server_module, "_build_data_service", return_value=service),
        patch.object(
            server_module,
            "clarify_resolve_issue_areas_result",
            new=AsyncMock(return_value=clarified),
        ) as clarify_mock,
    ):
        mcp = build_mcp()
        _content, payload = await mcp.call_tool(
            "resolve_issue_areas",
            {"text": "housing", "limit": 5},
        )

    assert payload == clarified
    service.resolve_issue_areas.assert_awaited_once_with("housing", limit=5)
    clarify_mock.assert_awaited_once()
