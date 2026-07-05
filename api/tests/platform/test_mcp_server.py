"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.responses import Response

from atlas.config import Settings
from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from atlas.platform.mcp.server import build_mcp, get_mcp, get_mcp_asgi_app, mcp_session_lifespan

if TYPE_CHECKING:
    from collections.abc import Iterator

HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_OK = 200

EXPECTED_TOOL_NAMES = {
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
    "resolve_issue_areas",
    "start_discovery_run",
}


@pytest.mark.asyncio
async def test_build_mcp_registers_all_atlas_tools() -> None:
    """build_mcp() registers exactly Atlas's 12 read tools plus start_discovery_run."""
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
async def test_list_discovery_runs_tool_has_expected_schema() -> None:
    """The list_discovery_runs tool exposes filters agents need for research artifacts."""
    mcp = build_mcp()
    tools = await mcp.list_tools()
    tool = next(tool for tool in tools if tool.name == "list_discovery_runs")
    properties = tool.inputSchema.get("properties", {})
    expected = {"state", "status", "limit", "cursor"}
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
