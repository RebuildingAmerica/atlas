"""Tests for the application factory, lifespan, and conditional route registration."""

from __future__ import annotations

from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import httpx
import pytest

from atlas.main import McpMountPathAliasMiddleware, create_app, lifespan
from atlas.platform.config import Settings, get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def _patch_mcp_session_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use a fresh no-op MCP session manager for direct lifespan tests."""

    @asynccontextmanager
    async def run() -> AsyncIterator[None]:
        yield

    session_manager = MagicMock()
    session_manager.run = run
    mcp = MagicMock()
    mcp.session_manager = session_manager
    monkeypatch.setattr("atlas.main.get_mcp", lambda: mcp)


class TestLifespan:
    """Tests for the application lifespan (startup/shutdown)."""

    @pytest.mark.asyncio
    async def test_lifespan_initializes_database(self, db_url: str) -> None:
        """The lifespan should call init_db on startup."""
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
        )

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: settings

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health")
            assert response.status_code == HTTPStatus.OK

    @pytest.mark.asyncio
    async def test_lifespan_propagates_init_db_failure(self) -> None:
        """If init_db fails, the lifespan should propagate the exception."""
        from atlas.main import lifespan

        settings = Settings(
            database_url="sqlite:///atlas_test.db",
            deploy_mode="local",
        )

        async def failing_init_db(_url: str, **_kwargs: object) -> None:
            raise RuntimeError("init")

        mock_app = MagicMock()

        with (
            patch("atlas.main.get_settings", return_value=settings),
            patch("atlas.main.init_db", new=failing_init_db),
            pytest.raises(RuntimeError, match="init"),
        ):
            async with lifespan(mock_app):
                pass


class TestConditionalRoutes:
    """Tests for conditionally registered routes based on settings."""

    def test_openapi_route_registered_when_enabled(self) -> None:
        """When enable_openapi_spec is True, /openapi.json should be registered."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
            enable_openapi_spec=True,
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/openapi.json" in route_paths

    def test_openapi_route_missing_when_disabled(self) -> None:
        """When enable_openapi_spec is False, /openapi.json should not be registered."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
            enable_openapi_spec=False,
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/openapi.json" not in route_paths

    def test_docs_routes_registered_when_enabled(self) -> None:
        """When enable_api_docs_ui is True, only Scalar docs should be registered."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
            enable_api_docs_ui=True,
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/docs" in route_paths
        assert "/redoc" not in route_paths

    def test_docs_routes_missing_when_disabled(self) -> None:
        """When enable_api_docs_ui is False, /docs and /redoc should not be registered."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
            enable_api_docs_ui=False,
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/docs" not in route_paths
        assert "/redoc" not in route_paths


class TestDocsEndpoints:
    """Tests for the actual docs endpoints when enabled."""

    @pytest.mark.asyncio
    async def test_scalar_docs_returns_html(self, test_client: object) -> None:
        """The /docs endpoint should return the Scalar API reference."""
        response = await test_client.get("/docs")
        assert response.status_code == HTTPStatus.OK
        assert "text/html" in response.headers["content-type"]
        assert "Scalar.createApiReference" in response.text
        assert '"showOperationId": true' in response.text
        assert '"persistAuth": true' in response.text
        assert "swagger-ui" not in response.text.lower()
        assert "redoc" not in response.text.lower()

    @pytest.mark.asyncio
    async def test_redoc_route_is_removed(self, test_client: object) -> None:
        """The legacy /redoc endpoint should not expose a docs UI."""
        response = await test_client.get("/redoc")
        assert response.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_openapi_json_returns_schema(self, test_client: object) -> None:
        """The /openapi.json endpoint should return a valid OpenAPI schema."""
        response = await test_client.get("/openapi.json")
        assert response.status_code == HTTPStatus.OK
        payload = response.json()
        assert "openapi" in payload
        assert "info" in payload
        assert payload["info"]["title"] == "Atlas REST API"


class TestProductionCorsGuard:
    """Atlas refuses to boot when production deployments expose '*' CORS."""

    def test_create_app_raises_when_production_cors_contains_wildcard(self) -> None:
        """A '*' origin in production must raise at app construction."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            cors_origins=["*"],
            deploy_mode="local",
        )

        with (
            patch("atlas.main.get_settings", return_value=settings),
            pytest.raises(RuntimeError, match="CORS_ORIGINS"),
        ):
            create_app()


class TestMcpMount:
    """The public MCP mount accepts the documented path without redirects."""

    @pytest.mark.asyncio
    async def test_exact_mcp_mount_path_does_not_redirect(self, db_url: str) -> None:
        """Clients configured with `/mcp` should receive the auth challenge directly."""
        settings = Settings(
            database_url=db_url,
            auth_jwt_issuer="https://atlas.test",
            auth_jwt_audience=["https://atlas.test/mcp"],
            deploy_mode="production",
        )

        with (
            patch("atlas.main.get_settings", return_value=settings),
            patch("atlas.platform.mcp.auth_middleware.get_settings", return_value=settings),
        ):
            app = create_app()
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="https://atlas.test",
                follow_redirects=False,
            ) as client:
                response = await client.post("/mcp", json={})

        assert response.status_code == HTTPStatus.UNAUTHORIZED
        assert "location" not in response.headers
        assert response.headers["www-authenticate"].startswith("Bearer ")

    @pytest.mark.asyncio
    async def test_exact_mcp_mount_path_preserves_noncanonical_raw_path(self) -> None:
        """Proxy-provided raw paths should not be guessed or rebuilt."""
        received_scopes: list[dict[str, object]] = []
        sent_messages: list[dict[str, object]] = []

        async def inner_app(scope: dict[str, object], _receive: object, send: object) -> None:
            received_scopes.append(scope)
            await send({"type": "http.response.start", "status": HTTPStatus.NO_CONTENT})
            await send({"type": "http.response.body", "body": b""})

        middleware = McpMountPathAliasMiddleware(inner_app)
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/mcp",
            "raw_path": b"/edge/mcp",
            "headers": [],
        }

        async def receive() -> dict[str, object]:
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message: dict[str, object]) -> None:
            sent_messages.append(message)

        await middleware(scope, receive, send)

        assert received_scopes[0]["path"] == "/mcp/"
        assert received_scopes[0]["raw_path"] == b"/edge/mcp"
        assert scope["path"] == "/mcp"
        assert sent_messages[0]["status"] == HTTPStatus.NO_CONTENT


class TestOAuthProtectedResourceMetadata:
    """The API mirrors RFC 9728 metadata for direct API-origin clients."""

    @pytest.mark.asyncio
    async def test_metadata_endpoint_advertises_authorization_server(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Metadata payload should reflect the configured issuer and audience."""
        monkeypatch.setenv("ATLAS_PUBLIC_URL", "https://issuer.test")
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
            auth_jwt_audience=["https://atlas.test/api"],
        )
        # The endpoint closure captures `settings` at create_app() time, so
        # we have to seed get_settings before constructing the app.
        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/.well-known/oauth-protected-resource")

        assert response.status_code == HTTPStatus.OK
        body = response.json()
        assert body["resource"] == "https://atlas.test/api"
        assert body["authorization_servers"] == [settings.auth_jwt_issuer]
        assert body["jwks_uri"] == settings.auth_jwt_jwks_url
        assert body["resource_documentation"] == "https://issuer.test/docs/mcp"
        assert body["scopes_supported"] == ["discovery:read", "api.mcp"]
        assert "offline_access" not in body["scopes_supported"]

    @pytest.mark.asyncio
    async def test_metadata_endpoint_omits_jwks_when_unset(self, db_url: str) -> None:
        """When no JWKS URL is configured, the metadata payload omits jwks_uri."""
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
        )
        # The validator only runs at construction; assign empty strings after
        # the model is built to drop the JWKS URL/issuer for this test.
        settings.auth_jwt_issuer = ""
        settings.auth_jwt_jwks_url = ""
        settings.auth_jwt_audience = []

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/.well-known/oauth-protected-resource")

        assert response.status_code == HTTPStatus.OK
        body = response.json()
        assert "jwks_uri" not in body
        assert body["authorization_servers"] == []


class TestLifespanWorker:
    """The full lifespan should boot the durable job worker."""

    @pytest.mark.asyncio
    async def test_lifespan_starts_and_stops_job_worker(
        self, db_url: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A clean lifespan should call start_job_worker and stop_job_worker."""
        _patch_mcp_session_manager(monkeypatch)
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
        )

        started: list[dict[str, object]] = []
        stopped: list[bool] = []

        async def fake_start(database_url: str, **kwargs: object) -> None:
            started.append({"database_url": database_url, **kwargs})

        async def fake_stop() -> None:
            stopped.append(True)

        monkeypatch.setattr("atlas.domains.discovery.worker.start_job_worker", fake_start)
        monkeypatch.setattr("atlas.domains.discovery.worker.stop_job_worker", fake_stop)

        mock_app = MagicMock()
        with patch("atlas.main.get_settings", return_value=settings):
            async with lifespan(mock_app):
                # The lifespan should have already started the worker.
                assert started, "expected start_job_worker to have been invoked"
        assert stopped == [True]

    @pytest.mark.asyncio
    async def test_lifespan_skips_job_worker_when_disabled(
        self, db_url: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A disabled worker flag should leave job claiming to an external Scout."""
        _patch_mcp_session_manager(monkeypatch)
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
            discovery_job_worker_enabled=False,
        )

        started: list[bool] = []
        stopped: list[bool] = []

        async def fake_start(_database_url: str, **_kwargs: object) -> None:
            started.append(True)

        async def fake_stop() -> None:
            stopped.append(True)

        monkeypatch.setattr("atlas.domains.discovery.worker.start_job_worker", fake_start)
        monkeypatch.setattr("atlas.domains.discovery.worker.stop_job_worker", fake_stop)

        mock_app = MagicMock()
        with patch("atlas.main.get_settings", return_value=settings):
            async with lifespan(mock_app):
                assert started == []
        assert stopped == []
