"""Tests for the auth integration health check endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest

from atlas.domains.access.api import health as health_module
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
        test_settings.multi_user = False
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


_REAL_ASYNC_CLIENT = httpx.AsyncClient


class _MockAsyncClient:
    """Stand-in for httpx.AsyncClient that uses a MockTransport for HEAD requests."""

    def __init__(self, transport: httpx.MockTransport) -> None:
        self._client = _REAL_ASYNC_CLIENT(transport=transport)

    async def __aenter__(self) -> _MockAsyncClient:
        await self._client.__aenter__()
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        await self._client.__aexit__(exc_type, exc, tb)  # type: ignore[arg-type]

    async def head(self, url: str) -> httpx.Response:
        return await self._client.head(url)


def _make_async_client_factory(
    transport: httpx.MockTransport,
) -> object:
    def factory(*, timeout: float) -> _MockAsyncClient:
        del timeout
        return _MockAsyncClient(transport)

    return factory


class TestAuthHealthRemoteMode:
    """Auth health endpoint when not in local mode."""

    @pytest.mark.asyncio
    async def test_reports_ok_when_all_endpoints_reachable(
        self,
        test_client: object,
        test_settings: Settings,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """All reachable + configured introspection should yield status=ok."""
        test_settings.multi_user = True
        test_settings.auth_jwt_jwks_url = "https://auth.example.com/jwks"
        test_settings.auth_membership_verification_url = "https://auth.example.com/memberships"
        test_settings.auth_api_key_introspection_url = "https://auth.example.com/introspect"

        transport = httpx.MockTransport(handler=lambda _: httpx.Response(200))
        monkeypatch.setattr(
            health_module.httpx, "AsyncClient", _make_async_client_factory(transport)
        )

        response = await test_client.get("/api/auth/health")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["status"] == "ok"
        assert data["checks"]["jwks"] == "reachable"
        assert data["checks"]["membership"] == "reachable"
        assert data["checks"]["api_key_introspection"] == "configured"

    @pytest.mark.asyncio
    async def test_reports_degraded_when_dependencies_missing(
        self,
        test_client: object,
        test_settings: Settings,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Missing membership/introspection URLs and an unreachable JWKS yield degraded."""
        test_settings.multi_user = True
        test_settings.auth_jwt_jwks_url = "https://auth.example.com/jwks"
        test_settings.auth_membership_verification_url = None
        test_settings.auth_api_key_introspection_url = None

        def raise_error(_: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("offline")

        transport = httpx.MockTransport(handler=raise_error)
        monkeypatch.setattr(
            health_module.httpx, "AsyncClient", _make_async_client_factory(transport)
        )

        response = await test_client.get("/api/auth/health")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["status"] == "degraded"
        assert data["checks"]["jwks"] == "unreachable"
        assert data["checks"]["membership"] == "not_configured"
        assert data["checks"]["api_key_introspection"] == "not_configured"
