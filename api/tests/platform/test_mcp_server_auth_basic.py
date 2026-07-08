"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.responses import Response

from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware
from tests.support.mcp_server import (
    HTTP_FORBIDDEN,
    HTTP_OK,
    HTTP_UNAUTHORIZED,
)


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
