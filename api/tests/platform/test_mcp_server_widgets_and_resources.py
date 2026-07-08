"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from starlette.middleware.cors import CORSMiddleware

from atlas.config import Settings
from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from atlas.platform.mcp.server import (
    build_mcp,
    get_mcp_asgi_app,
    mcp_session_lifespan,
    split_cors_origins,
)
from atlas.platform.mcp.widgets import (
    CONNECTIONS_GRAPH_RESOURCE_URI,
    ENTITY_CARD_RESOURCE_URI,
    SEARCH_RESULTS_RESOURCE_URI,
)
from tests.support.mcp_server import (
    HTTP_OK,
)


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

    def _build_stub_data_service() -> StubService:
        return StubService()

    monkeypatch.setattr(server_module, "_build_data_service", _build_stub_data_service)
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
