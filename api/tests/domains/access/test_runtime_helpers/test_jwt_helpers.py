"""JWT and JWKS runtime helpers."""

from __future__ import annotations

from types import SimpleNamespace

import jwt
import pytest

from atlas.domains.access import jwt as auth_jwt_module

from .support import BAD_TOKEN_ERROR


def test_invalidate_jwks_cache_clears_module_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """invalidate_jwks_cache should clear the cached client and URL."""
    monkeypatch.setattr(auth_jwt_module, "_jwks_client", object())
    monkeypatch.setattr(auth_jwt_module, "_jwks_client_url", "https://atlas.example/jwks")

    auth_jwt_module.invalidate_jwks_cache()

    assert auth_jwt_module._jwks_client is None  # noqa: SLF001
    assert auth_jwt_module._jwks_client_url is None  # noqa: SLF001


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


def test_jwt_helpers_accept_app_issued_eddsa_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """JWT verification should accept the EdDSA tokens issued by the Atlas app."""
    ed25519 = pytest.importorskip("cryptography.hazmat.primitives.asymmetric.ed25519")
    private_key = ed25519.Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    token = jwt.encode(
        {
            "aud": "atlas-api",
            "email": "operator@example.com",
            "iss": "https://atlas.example/api/auth",
            "permissions": {"entities": ["write"]},
            "sub": "user_123",
        },
        private_key,
        algorithm="EdDSA",
        headers={"kid": "test-key"},
    )

    class FakeJwksClient:
        def get_signing_key_from_jwt(self, token_value: str) -> SimpleNamespace:
            assert token_value == token
            return SimpleNamespace(key=public_key)

    monkeypatch.setattr(auth_jwt_module, "get_jwks_client", lambda _url: FakeJwksClient())

    assert auth_jwt_module.verify_bearer_jwt(
        f"Bearer {token}",
        issuer="https://atlas.example/api/auth",
        audience=["atlas-api"],
        jwks_url="https://atlas.example/api/auth/jwks",
    ) == {
        "aud": "atlas-api",
        "email": "operator@example.com",
        "iss": "https://atlas.example/api/auth",
        "permissions": {"entities": ["write"]},
        "sub": "user_123",
    }
