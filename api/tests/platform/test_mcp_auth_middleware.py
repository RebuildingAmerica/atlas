"""Tests for MCP Bearer JWT auth middleware."""

from unittest.mock import patch

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware


def _echo_endpoint(request: Request) -> PlainTextResponse:  # noqa: ARG001
    return PlainTextResponse("ok")


def _build_test_app() -> Starlette:
    app = Starlette(routes=[Route("/", _echo_endpoint)])
    app.add_middleware(McpBearerAuthMiddleware)
    return app


@pytest.fixture
def _no_audience() -> object:
    """Patch settings so auth_jwt_audience is empty (auth disabled)."""
    return patch(
        "atlas.platform.mcp.auth_middleware.get_settings",
        return_value=_fake_settings(audience=""),
    )


@pytest.fixture
def _with_audience() -> object:
    """Patch settings so auth_jwt_audience is set (auth enabled)."""
    return patch(
        "atlas.platform.mcp.auth_middleware.get_settings",
        return_value=_fake_settings(audience="https://api.atlas.test"),
    )


class _FakeSettings:
    def __init__(self, audience: str) -> None:
        self.auth_jwt_audience = audience
        self.auth_jwt_issuer = "https://atlas.test/api/auth"
        self.auth_jwt_jwks_url = "https://atlas.test/api/auth/jwks"


def _fake_settings(audience: str) -> _FakeSettings:
    return _FakeSettings(audience=audience)


def test_passes_through_when_no_audience_configured(_no_audience: object) -> None:  # noqa: PT019
    """Requests should pass when auth is disabled (no audience)."""
    with _no_audience:
        client = TestClient(_build_test_app())
        response = client.get("/")

    assert response.status_code == 200  # noqa: PLR2004
    assert response.text == "ok"


def test_rejects_request_without_bearer_token(_with_audience: object) -> None:  # noqa: PT019
    """Unauthenticated requests should return 401 with WWW-Authenticate."""
    with (
        _with_audience,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt", return_value=None),
    ):
        client = TestClient(_build_test_app())
        response = client.get("/")

    assert response.status_code == 401  # noqa: PLR2004
    assert "Bearer" in response.headers["www-authenticate"]
    assert "oauth-protected-resource" in response.headers["www-authenticate"]


def test_rejects_invalid_bearer_token(_with_audience: object) -> None:  # noqa: PT019
    """Invalid JWTs should return 401."""
    with (
        _with_audience,
        patch("atlas.platform.mcp.auth_middleware.verify_bearer_jwt", return_value=None),
    ):
        client = TestClient(_build_test_app())
        response = client.get("/", headers={"Authorization": "Bearer bad-token"})

    assert response.status_code == 401  # noqa: PLR2004


def test_passes_through_with_valid_bearer_token(_with_audience: object) -> None:  # noqa: PT019
    """Valid JWTs should reach the handler."""
    valid_payload = {"sub": "user-123", "email": "test@atlas.test"}

    with (
        _with_audience,
        patch(
            "atlas.platform.mcp.auth_middleware.verify_bearer_jwt",
            return_value=valid_payload,
        ),
    ):
        client = TestClient(_build_test_app())
        response = client.get("/", headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 200  # noqa: PLR2004
    assert response.text == "ok"
