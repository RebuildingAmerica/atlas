"""JWT verification for OAuth 2.1 Bearer tokens."""

from __future__ import annotations

import jwt
from jwt import PyJWKClient

_jwks_client: PyJWKClient | None = None


def get_jwks_client(jwks_url: str) -> PyJWKClient:
    """Return a cached JWKS client for the given URL."""
    global _jwks_client  # noqa: PLW0603
    if _jwks_client is None:
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def verify_bearer_jwt(
    authorization: str | None,
    *,
    issuer: str,
    audience: str,
    jwks_url: str,
) -> dict[str, object] | None:
    """Return decoded JWT payload or None if not a valid Bearer JWT."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ")
    try:
        client = get_jwks_client(jwks_url)
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            issuer=issuer,
            audience=audience,
        )
    except jwt.PyJWTError:
        return None
