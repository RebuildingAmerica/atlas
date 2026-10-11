"""Verify the short-lived assertion the Atlas app signs for each call it makes on someone's behalf.

The app signs these with the same published keys as its customer tokens, but
for a dedicated audience no customer token can carry. A stolen database copy or
API host therefore cannot mint one, unlike the shared secret it replaces, and an
assertion lives only long enough to make one call.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, status

from .jwt import get_jwks_client
from .principals import AuthenticatedActor

logger = logging.getLogger(__name__)

APP_ACTOR_AUDIENCE = "urn:atlas:app-actor"
"""The audience the app sets on actor assertions and on nothing else."""

MAX_ASSERTION_LIFETIME_SECONDS = 120
"""Longest lifetime accepted, so a captured assertion cannot be replayed for long."""

INVALID_ASSERTION_DETAIL = "The app's identity assertion is not valid."

_SIGNING_ALGORITHMS = ["EdDSA", "ES256", "RS256"]
_LEEWAY_SECONDS = 30


def _invalid_assertion(reason: str) -> HTTPException:
    """Log why an assertion was refused and build the 401 the caller sees."""
    logger.warning("App actor assertion rejected", extra={"reason": reason})
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_ASSERTION_DETAIL)


_UNCONFIGURED = "issuer or JWKS URL is not configured"
_TOO_LONG_LIVED = "lifetime exceeds the maximum"


def verify_app_actor_assertion(token: str, *, issuer: str, jwks_url: str) -> AuthenticatedActor:
    """Return the person the app is acting for, or refuse the request.

    Parameters
    ----------
    token : str
        The ``X-Atlas-Actor-Assertion`` header value.
    issuer : str
        The app's token issuer, ``{ATLAS_PUBLIC_URL}/api/auth``.
    jwks_url : str
        Where the app publishes its signing keys.

    Returns
    -------
    AuthenticatedActor
        An ``internal`` actor whose ``account_ready`` is true only when the app
        says the session has a verified email and a registered passkey.

    Raises
    ------
    HTTPException
        401 when the assertion is unsigned, forged, expired, too long-lived,
        meant for another audience, or missing its subject or email. A present
        but invalid assertion is never ignored in favor of another credential.
    """
    import jwt

    if not issuer or not jwks_url:
        raise _invalid_assertion(_UNCONFIGURED)
    try:
        signing_key = get_jwks_client(jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=_SIGNING_ALGORITHMS,
            issuer=issuer,
            audience=APP_ACTOR_AUDIENCE,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "email"]},
        )
    except jwt.PyJWTError as exc:
        raise _invalid_assertion(type(exc).__name__) from exc

    if int(claims["exp"]) - int(claims["iat"]) > MAX_ASSERTION_LIFETIME_SECONDS:
        raise _invalid_assertion(_TOO_LONG_LIVED)
    raw_org_id = claims.get("org_id")
    return AuthenticatedActor(
        user_id=str(claims["sub"]),
        email=str(claims["email"]),
        auth_type="internal",
        org_id=str(raw_org_id) if raw_org_id else None,
        account_ready=claims.get("account_ready") is True,
    )
