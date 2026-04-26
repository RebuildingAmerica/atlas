"""Tests for the auth integration health check endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest

from atlas.domains.access.api.health import _check_url

if TYPE_CHECKING:
    from atlas.platform.config import Settings

STATUS_OK = 200


class TestAuthHealthLocalMode:
    """Auth health endpoint in local/dev mode."""

    @pytest.mark.asyncio
    async def test_returns_ok_in_local_mode(
        self, test_client: object, test_settings: Settings
    ) -> None:
        """Local mode should short-circuit and return ok without external requests."""
        test_settings.deploy_mode = "local"
        response = await test_client.get("/api/auth/health")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["status"] == "ok"
        assert data["mode"] == "local"
        assert data["checks"] == {}


class TestCheckUrlHelper:
    """Unit tests for the _check_url helper."""

    @pytest.mark.asyncio
    async def test_returns_not_configured_for_empty_url(self) -> None:
        """An empty URL string should immediately return not_configured."""
        async with httpx.AsyncClient() as client:
            result = await _check_url(client, "", "test-label")
        assert result == "not_configured"

    @pytest.mark.asyncio
    async def test_returns_reachable_for_successful_response(self) -> None:
        """A 200 response should be reported as reachable."""
        transport = httpx.MockTransport(handler=lambda _: httpx.Response(200))
        async with httpx.AsyncClient(transport=transport) as client:
            result = await _check_url(client, "http://auth.example.com/health", "jwks")
        assert result == "reachable"

    @pytest.mark.asyncio
    async def test_returns_reachable_for_404_response(self) -> None:
        """A 404 is not a server error, so it still counts as reachable."""
        transport = httpx.MockTransport(handler=lambda _: httpx.Response(404))
        async with httpx.AsyncClient(transport=transport) as client:
            result = await _check_url(client, "http://auth.example.com/jwks", "jwks")
        assert result == "reachable"

    @pytest.mark.asyncio
    async def test_returns_server_error_for_5xx_response(self) -> None:
        """A 5xx response should be reported as server_error."""
        transport = httpx.MockTransport(handler=lambda _: httpx.Response(503))
        async with httpx.AsyncClient(transport=transport) as client:
            result = await _check_url(client, "http://auth.example.com/jwks", "jwks")
        assert result == "server_error"

    @pytest.mark.asyncio
    async def test_returns_unreachable_on_request_error(self) -> None:
        """A connection failure should be reported as unreachable."""

        def raise_error(_: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("")

        transport = httpx.MockTransport(handler=raise_error)
        async with httpx.AsyncClient(transport=transport) as client:
            result = await _check_url(client, "http://auth.example.com/jwks", "jwks")
        assert result == "unreachable"
