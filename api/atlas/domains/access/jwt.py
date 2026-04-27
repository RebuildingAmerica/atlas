"""JWT verification for OAuth 2.1 Bearer tokens."""

from __future__ import annotations

import logging

import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

_jwks_client: PyJWKClient | None = None
_jwks_client_url: str | None = None

# JWKS cache lifespan in seconds.  Sixty seconds matches the maximum delay an
# emergency key rotation by the authorization server can incur on the resource
# server before fresh keys are pulled.  Pair with `invalidate_jwks_cache()` for
# operator-driven invalidation when the rotation cannot wait the full TTL.
_JWKS_CACHE_LIFESPAN_SECONDS = 60


def get_jwks_client(jwks_url: str) -> PyJWKClient:
    """Return a cached JWKS client for the given URL.

    Creates a new client when the URL changes or no client exists yet.
    """
    global _jwks_client, _jwks_client_url  # noqa: PLW0603
    if _jwks_client is None or _jwks_client_url != jwks_url:
        _jwks_client = PyJWKClient(
            jwks_url,
            cache_jwk_set=True,
            lifespan=_JWKS_CACHE_LIFESPAN_SECONDS,
        )
        _jwks_client_url = jwks_url
    return _jwks_client


def invalidate_jwks_cache() -> None:
    """Drop the cached JWKS client so the next request fetches fresh keys.

    Call this from a maintenance shell after the authorization server rotates
    its signing keys outside of the regular schedule, when waiting up to
    `_JWKS_CACHE_LIFESPAN_SECONDS` for natural expiry is not acceptable.
    """
    global _jwks_client, _jwks_client_url  # noqa: PLW0603
    _jwks_client = None
    _jwks_client_url = None


# Token verification leeway in seconds.  RFC 9700 §4.1 recommends a small but
# non-zero window so legitimate tokens are not rejected by minor NTP drift on
# either the AS or RS while still bounding any clock-skew abuse.
_JWT_LEEWAY_SECONDS = 30


def verify_bearer_jwt(
    authorization: str | None,
    *,
    issuer: str,
    audience: list[str],
    jwks_url: str,
) -> dict[str, object] | None:
    """Return decoded JWT payload or None if not a valid Bearer JWT.

    A token is accepted when its `aud` claim matches any value in `audience`.
    PyJWT itself accepts a list and treats matches as inclusive.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    if not audience:
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
            leeway=_JWT_LEEWAY_SECONDS,
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
