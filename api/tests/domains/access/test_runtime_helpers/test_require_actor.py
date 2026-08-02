"""Request actor resolution helpers."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.principals import ApiKeyPrincipal

if TYPE_CHECKING:
    from atlas.platform.config import Settings


@pytest.mark.asyncio
async def test_require_actor_verifies_api_key_without_middleware_state(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Protected routes outside the limited set should still verify API keys."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"

    async def fake_verify_api_key(
        api_key: str,
        _settings: Settings,
    ) -> ApiKeyPrincipal | None:
        if api_key == "invalid-key":
            return None
        assert api_key == "atlas_test_key"
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id=None,
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    actor = await require_actor(
        SimpleNamespace(headers={}),
        settings=test_settings,
        x_atlas_internal_secret=None,
        x_atlas_actor_id=None,
        x_atlas_actor_email=None,
        x_api_key="atlas_test_key",
    )

    assert actor.auth_type == "api_key"
    assert actor.user_id == "user_123"

    with pytest.raises(HTTPException, match="Authentication required"):
        await require_actor(
            SimpleNamespace(headers={}),
            settings=test_settings,
            x_atlas_internal_secret=None,
            x_atlas_actor_id=None,
            x_atlas_actor_email=None,
            x_api_key="invalid-key",
        )


@pytest.mark.asyncio
async def test_require_actor_accepts_oauth_jwts_and_rejects_anonymous_requests(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Protected dependencies should accept one auth scheme and reject ambiguous requests."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_jwt_issuer = "https://atlas.example"
    test_settings.auth_jwt_audience = ["atlas-api"]
    test_settings.auth_jwt_jwks_url = "https://atlas.example/jwks"

    def fake_verify_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> dict[str, object]:
        del authorization, issuer, audience, jwks_url
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "permissions": {"discovery": ["read"]},
        }

    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_bearer_jwt", fake_verify_bearer_jwt
    )

    with pytest.raises(HTTPException, match="Use exactly one authentication method"):
        await require_actor(
            SimpleNamespace(headers={"authorization": "Bearer token-123"}),
            settings=test_settings,
            x_atlas_internal_secret=None,
            x_atlas_actor_id=None,
            x_atlas_actor_email=None,
            x_api_key="atlas_test_key",
        )

    actor = await require_actor(
        SimpleNamespace(headers={"authorization": "Bearer token-123"}),
        settings=test_settings,
        x_atlas_internal_secret=None,
        x_atlas_actor_id=None,
        x_atlas_actor_email=None,
        x_api_key=None,
    )
    assert actor.auth_type == "oauth_jwt"
    assert actor.user_id == "user_123"

    def reject_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> None:
        del authorization, issuer, audience, jwks_url

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_bearer_jwt", reject_bearer_jwt)
    with pytest.raises(HTTPException, match="Authentication required"):
        await require_actor(
            SimpleNamespace(headers={}),
            settings=test_settings,
            x_atlas_internal_secret=None,
            x_atlas_actor_id=None,
            x_atlas_actor_email=None,
            x_api_key=None,
        )
