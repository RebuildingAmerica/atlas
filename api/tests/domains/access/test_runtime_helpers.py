"""Runtime-level tests for Atlas auth helpers."""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import jwt
import pytest
from fastapi import HTTPException

from atlas.domains.access import jwt as auth_jwt_module
from atlas.domains.access.api_keys import verify_api_key
from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.internal import build_local_actor, verify_internal_actor
from atlas.domains.access.permissions import has_permission, require_permission
from atlas.domains.access.principals import AuthenticatedActor
from atlas.platform.config import Settings

BAD_TOKEN_ERROR = "bad token"


class _FakeAsyncClient:
    def __init__(self, response: object) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def post(self, url: str, headers: dict[str, str]) -> object:
        self.url = url
        self.headers = headers
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _async_client_factory(response: object) -> object:
    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return _FakeAsyncClient(response)

    return factory


@pytest.mark.asyncio
async def test_verify_api_key_returns_none_without_introspection_settings(
    test_settings: Settings,
) -> None:
    """API-key auth should be disabled when required runtime config is missing."""
    test_settings.auth_api_key_introspection_url = None
    test_settings.auth_internal_secret = ""

    assert await verify_api_key("atlas_test_key", test_settings) is None


@pytest.mark.asyncio
async def test_verify_api_key_handles_success_and_rejected_tokens(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Introspection should accept valid keys and reject invalid ones cleanly."""
    test_settings.auth_api_key_introspection_url = "https://auth.example.test/introspect"
    test_settings.auth_internal_secret = "internal-test-secret"

    success_response = httpx.Response(
        200,
        json={
            "valid": True,
            "keyId": "key_123",
            "name": "Atlas CLI",
            "permissions": {"discovery": ["read"]},
            "userId": "user_123",
            "userEmail": "operator@example.com",
        },
        request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
    )
    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(success_response),
    )

    principal = await verify_api_key("atlas_test_key", test_settings)

    assert principal is not None
    assert principal.key_id == "key_123"
    assert principal.permissions == {"discovery": ["read"]}

    invalid_response = httpx.Response(
        200,
        json={"valid": False},
        request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
    )
    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(invalid_response),
    )

    assert await verify_api_key("atlas_test_key", test_settings) is None


@pytest.mark.asyncio
async def test_verify_api_key_treats_not_found_and_unauthorized_as_invalid(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Missing or unauthorized introspection responses should behave like invalid keys."""
    test_settings.auth_api_key_introspection_url = "https://auth.example.test/introspect"
    test_settings.auth_internal_secret = "internal-test-secret"

    for status_code in (401, 404):
        response = httpx.Response(
            status_code,
            request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
        )
        monkeypatch.setattr(
            "atlas.domains.access.api_keys.httpx.AsyncClient",
            _async_client_factory(response),
        )
        assert await verify_api_key("atlas_test_key", test_settings) is None


@pytest.mark.asyncio
async def test_verify_api_key_raises_for_server_errors_and_transport_failures(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Operational introspection failures should still surface upstream."""
    test_settings.auth_api_key_introspection_url = "https://auth.example.test/introspect"
    test_settings.auth_internal_secret = "internal-test-secret"

    server_error = httpx.Response(
        500,
        text="upstream boom",
        request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
    )
    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(server_error),
    )
    with pytest.raises(httpx.HTTPStatusError):
        await verify_api_key("atlas_test_key", test_settings)

    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(RuntimeError("network down")),
    )
    with pytest.raises(RuntimeError, match="network down"):
        await verify_api_key("atlas_test_key", test_settings)


def test_verify_internal_actor_and_local_actor_cover_success_and_validation() -> None:
    """Trusted internal headers should build actors and reject incomplete identity."""
    settings = Settings()
    settings.auth_internal_secret = "internal-test-secret"

    actor = verify_internal_actor(
        settings,
        internal_secret="internal-test-secret",
        actor_id="user_123",
        actor_email="operator@example.com",
    )

    assert actor is not None
    assert actor.auth_type == "internal"
    assert build_local_actor().is_local is True

    with pytest.raises(HTTPException, match="Trusted requests must include actor identity headers"):
        verify_internal_actor(
            settings,
            internal_secret="internal-test-secret",
            actor_id=None,
            actor_email="operator@example.com",
        )


def test_permission_helpers_enforce_api_key_and_jwt_scopes() -> None:
    """Permission helpers should pass through locals and reject missing scoped access."""
    local_actor = AuthenticatedActor(
        user_id="local",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )
    assert has_permission(local_actor, "entities", "write") is True

    api_key_actor = AuthenticatedActor(
        user_id="user_123",
        email="operator@example.com",
        auth_type="api_key",
        permissions={"discovery": ["read"]},
    )
    assert has_permission(api_key_actor, "entities", "write") is False
    with pytest.raises(HTTPException, match="Insufficient API key permissions"):
        require_permission(api_key_actor, "entities", "write")

    jwt_actor_without_permissions = AuthenticatedActor(
        user_id="user_456",
        email="jwt@example.com",
        auth_type="oauth_jwt",
        permissions=None,
    )
    assert has_permission(jwt_actor_without_permissions, "discovery", "read") is False
    with pytest.raises(HTTPException, match="Insufficient API key permissions"):
        require_permission(jwt_actor_without_permissions, "discovery", "read")


def test_jwt_helpers_cache_keys_and_decode_bearer_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """JWT verification should cache JWKS clients and decode valid bearer tokens."""
    constructors: list[str] = []

    class FakeJwksClient:
        def __init__(self, jwks_url: str, *, cache_jwk_set: bool, lifespan: int) -> None:
            constructors.append(jwks_url)
            self.jwks_url = jwks_url
            self.cache_jwk_set = cache_jwk_set
            self.lifespan = lifespan

        def get_signing_key_from_jwt(self, token: str) -> SimpleNamespace:
            assert token == "token-123"
            return SimpleNamespace(key="public-key")

    monkeypatch.setattr(auth_jwt_module, "_jwks_client", None)
    monkeypatch.setattr(auth_jwt_module, "_jwks_client_url", None)
    monkeypatch.setattr(auth_jwt_module, "PyJWKClient", FakeJwksClient)

    def fake_decode(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "permissions": {"entities": ["write"]},
        }

    monkeypatch.setattr(auth_jwt_module.jwt, "decode", fake_decode)

    first_client = auth_jwt_module.get_jwks_client("https://atlas.example/jwks")
    second_client = auth_jwt_module.get_jwks_client("https://atlas.example/jwks")
    assert first_client is second_client
    assert constructors == ["https://atlas.example/jwks"]

    assert auth_jwt_module.verify_bearer_jwt(
        "Bearer token-123",
        issuer="https://atlas.example",
        audience=["atlas-api"],
        jwks_url="https://atlas.example/jwks",
    ) == {
        "sub": "user_123",
        "email": "operator@example.com",
        "permissions": {"entities": ["write"]},
    }
    assert (
        auth_jwt_module.verify_bearer_jwt(
            "Basic abc",
            issuer="https://atlas.example",
            audience=["atlas-api"],
            jwks_url="https://atlas.example/jwks",
        )
        is None
    )

    assert (
        auth_jwt_module.verify_bearer_jwt(
            "Bearer token-123",
            issuer="https://atlas.example",
            audience=[],
            jwks_url="https://atlas.example/jwks",
        )
        is None
    )

    def raise_bad_token(*_args: object, **_kwargs: object) -> None:
        raise jwt.PyJWTError(BAD_TOKEN_ERROR)

    monkeypatch.setattr(auth_jwt_module.jwt, "decode", raise_bad_token)
    assert (
        auth_jwt_module.verify_bearer_jwt(
            "Bearer token-123",
            issuer="https://atlas.example",
            audience=["atlas-api"],
            jwks_url="https://atlas.example/jwks",
        )
        is None
    )


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
