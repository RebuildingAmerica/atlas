"""Tests for production and local CORS behavior."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from atlas.main import create_app
from atlas.platform.config import Settings


class TestProductionCorsGuard:
    """Production must not allow wildcard origins."""

    def test_create_app_raises_when_production_cors_contains_wildcard(self) -> None:
        """A '*' origin in production should fail fast."""
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


class TestOuterCorsLoopbackScoping:
    """The outer CORS layer should scope loopback access correctly."""

    @pytest.mark.asyncio
    async def test_production_rejects_a_loopback_wildcard_origin(self) -> None:
        """Production must not reflect an arbitrary loopback origin."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            cors_origins=["https://atlas.rebuildingus.org"],
            deploy_mode="local",
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.options(
                "/health",
                headers={
                    "Origin": "http://127.0.0.1:9999",
                    "Access-Control-Request-Method": "GET",
                },
            )

        assert "access-control-allow-origin" not in response.headers

    @pytest.mark.asyncio
    async def test_production_still_allows_its_configured_origin(self) -> None:
        """Configured production origins should still work."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="production",
            cors_origins=["https://atlas.rebuildingus.org"],
            deploy_mode="local",
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.options(
                "/health",
                headers={
                    "Origin": "https://atlas.rebuildingus.org",
                    "Access-Control-Request-Method": "GET",
                },
            )

        assert response.headers["access-control-allow-origin"] == "https://atlas.rebuildingus.org"

    @pytest.mark.asyncio
    async def test_dev_still_allows_a_loopback_wildcard_origin(self) -> None:
        """Local dev should keep loopback convenience."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            environment="dev",
            cors_origins=["http://localhost:3000"],
            deploy_mode="local",
        )

        with patch("atlas.main.get_settings", return_value=settings):
            app = create_app()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.options(
                "/health",
                headers={
                    "Origin": "http://127.0.0.1:9999",
                    "Access-Control-Request-Method": "GET",
                },
            )

        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:9999"
