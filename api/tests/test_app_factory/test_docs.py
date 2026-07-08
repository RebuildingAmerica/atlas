"""Tests for docs and route registration behavior."""

from __future__ import annotations

from http import HTTPStatus
from unittest.mock import patch

import pytest

from atlas.main import create_app
from atlas.platform.config import Settings


class TestConditionalRoutes:
    """Route registration depends on app settings."""

    def test_openapi_route_registered_when_enabled(self) -> None:
        """OpenAPI should be present when enabled."""
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
        """OpenAPI should be absent when disabled."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
            enable_openapi_spec=False,
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/openapi.json" not in route_paths

    def test_docs_routes_missing(self) -> None:
        """The API server should not expose human docs routes."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            deploy_mode="local",
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        route_paths = {getattr(r, "path", None) for r in app.routes}
        assert "/docs" not in route_paths
        assert "/redoc" not in route_paths


class TestDocsEndpoints:
    """Machine-readable docs endpoints."""

    @pytest.mark.asyncio
    async def test_api_docs_route_is_not_served(self, test_client: object) -> None:
        """The human API reference lives in Mintlify."""
        response = await test_client.get("/docs")
        assert response.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_redoc_route_is_removed(self, test_client: object) -> None:
        """The legacy /redoc endpoint should be gone."""
        response = await test_client.get("/redoc")
        assert response.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_openapi_json_returns_schema(self, test_client: object) -> None:
        """The OpenAPI document should be available."""
        response = await test_client.get("/openapi.json")
        assert response.status_code == HTTPStatus.OK
        payload = response.json()
        assert "openapi" in payload
        assert "info" in payload
        assert payload["info"]["title"] == "Atlas REST API"
