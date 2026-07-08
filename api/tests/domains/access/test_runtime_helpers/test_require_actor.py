"""Request actor resolution helpers."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException

from atlas.domains.access.dependencies import require_actor

if TYPE_CHECKING:
    from atlas.platform.config import Settings


@pytest.mark.asyncio
async def test_require_actor_accepts_oauth_jwts_and_rejects_anonymous_requests(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Protected dependencies should fall through from API keys to bearer JWTs and 401 otherwise."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_jwt_issuer = "https://atlas.example"
    test_settings.auth_jwt_audience = ["atlas-api"]
    test_settings.auth_jwt_jwks_url = "https://atlas.example/jwks"

    async def missing_principal(api_key: str, _settings: Settings) -> None:
        assert api_key == "atlas_test_key"

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", missing_principal)

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

    actor = await require_actor(
        SimpleNamespace(headers={"authorization": "Bearer token-123"}),
        settings=test_settings,
        x_atlas_internal_secret=None,
        x_atlas_actor_id=None,
        x_atlas_actor_email=None,
        x_api_key="atlas_test_key",
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
