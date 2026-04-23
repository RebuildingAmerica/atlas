"""Tests for the application factory, lifespan, and conditional route registration."""

from __future__ import annotations

from http import HTTPStatus
from unittest.mock import MagicMock, patch

import httpx
import pytest

from atlas.main import create_app
from atlas.platform.config import Settings, get_settings


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
        """When enable_api_docs_ui is True, /docs and /redoc should be registered."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
            enable_api_docs_ui=True,
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/docs" in route_paths
        assert "/redoc" in route_paths

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
    async def test_swagger_ui_returns_html(self, test_client: object) -> None:
        """The /docs endpoint should return an HTML response."""
        response = await test_client.get("/docs")
        assert response.status_code == HTTPStatus.OK
        assert "text/html" in response.headers["content-type"]

    @pytest.mark.asyncio
    async def test_redoc_returns_html(self, test_client: object) -> None:
        """The /redoc endpoint should return an HTML response."""
        response = await test_client.get("/redoc")
        assert response.status_code == HTTPStatus.OK
        assert "text/html" in response.headers["content-type"]

    @pytest.mark.asyncio
    async def test_openapi_json_returns_schema(self, test_client: object) -> None:
        """The /openapi.json endpoint should return a valid OpenAPI schema."""
        response = await test_client.get("/openapi.json")
        assert response.status_code == HTTPStatus.OK
        payload = response.json()
        assert "openapi" in payload
        assert "info" in payload
        assert payload["info"]["title"] == "Atlas REST API"
