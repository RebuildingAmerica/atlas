"""Tests for MCP mount path handling."""

from __future__ import annotations

from http import HTTPStatus
from unittest.mock import patch

import httpx
import pytest

from atlas.main import McpMountPathAliasMiddleware, create_app
from atlas.platform.config import Settings


class TestMcpMount:
    """The public MCP mount should accept the documented path."""

    @pytest.mark.asyncio
    async def test_exact_mcp_mount_path_does_not_redirect(self, db_url: str) -> None:
        """Clients configured with `/mcp` should get the auth challenge directly."""
        settings = Settings(
            database_url=db_url,
            auth_jwt_issuer="https://atlas.test",
            auth_jwt_audience=["https://atlas.test/mcp"],
            deploy_mode="local",
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
