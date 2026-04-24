"""JWT verification for OAuth 2.1 Bearer tokens."""

from __future__ import annotations

import logging

import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

_jwks_client: PyJWKClient | None = None
_jwks_client_url: str | None = None


def get_jwks_client(jwks_url: str) -> PyJWKClient:
    """Return a cached JWKS client for the given URL.

    Creates a new client when the URL changes or no client exists yet.
    """
    global _jwks_client, _jwks_client_url  # noqa: PLW0603
    if _jwks_client is None or _jwks_client_url != jwks_url:
        _jwks_client = PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=300)
        _jwks_client_url = jwks_url
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
        logger.warning(
            "Bearer JWT verification failed",
            extra={
                "expected_issuer": issuer,
                "expected_audience": audience,
                "jwks_url": jwks_url,
            },
            exc_info=True,
        )
        return None
