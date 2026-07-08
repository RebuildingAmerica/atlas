"""Tests for OAuth protected resource metadata."""

from __future__ import annotations

from http import HTTPStatus
from unittest.mock import patch

import httpx
import pytest

from atlas.main import create_app
from atlas.platform.config import Settings


class TestOAuthProtectedResourceMetadata:
    """The API mirrors RFC 9728 metadata for direct API clients."""

    @pytest.mark.asyncio
    async def test_metadata_endpoint_advertises_authorization_server(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The metadata should reflect the configured issuer and audience."""
        monkeypatch.setenv("ATLAS_PUBLIC_URL", "https://issuer.test")
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
            auth_jwt_audience=["https://atlas.test/api"],
        )
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
        """When JWKS is unset, the metadata should omit it."""
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
        )
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
