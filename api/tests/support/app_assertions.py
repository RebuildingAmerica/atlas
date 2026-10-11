"""Sign app actor assertions with a test key the API trusts during tests."""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import TYPE_CHECKING

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from atlas.domains.access.app_assertion import APP_ACTOR_AUDIENCE

if TYPE_CHECKING:
    import pytest

    from atlas.platform.config import Settings

TEST_APP_ORIGIN = "https://atlas.test"
TEST_APP_ISSUER = f"{TEST_APP_ORIGIN}/api/auth"
TEST_APP_JWKS_URL = "https://atlas.test/api/auth/jwks"
TEST_APP_KEY = Ed25519PrivateKey.generate()


class _TestJwksClient:
    """Answers every key lookup with the test app's public key."""

    def get_signing_key_from_jwt(self, _token: str) -> SimpleNamespace:
        return SimpleNamespace(key=TEST_APP_KEY.public_key())


def trust_test_app_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the API verify app assertions against the test key.

    Parameters
    ----------
    monkeypatch : pytest.MonkeyPatch
        Fixture used to swap the JWKS lookup for the duration of one test.
    """
    monkeypatch.setattr(
        "atlas.domains.access.app_assertion.get_jwks_client",
        lambda _url: _TestJwksClient(),
    )


def configure_test_app_issuer(settings: Settings) -> None:
    """Point the settings under test at the test app's issuer and keys.

    Parameters
    ----------
    settings : Settings
        Settings shared with the app under test; mutated in place.
    """
    settings.auth_jwt_issuer = TEST_APP_ISSUER
    settings.auth_jwt_jwks_url = TEST_APP_JWKS_URL


def sign_app_assertion(
    *,
    user_id: str,
    email: str,
    account_ready: bool = True,
    org_id: str | None = None,
    issuer: str = TEST_APP_ISSUER,
) -> str:
    """Sign the assertion the app would send for one signed-in session.

    Parameters
    ----------
    user_id : str
        The signed-in user's id.
    email : str
        The signed-in user's email.
    account_ready : bool
        Whether the session has a verified email and a registered passkey.
    org_id : str | None
        The session's active workspace, when it has one.
    issuer : str
        The app issuer the API under test expects.

    Returns
    -------
    str
        A compact JWT for the ``X-Atlas-Actor-Assertion`` header.
    """
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": issuer,
        "aud": APP_ACTOR_AUDIENCE,
        "sub": user_id,
        "email": email,
        "account_ready": account_ready,
        "iat": now,
        "exp": now + 60,
    }
    if org_id is not None:
        claims["org_id"] = org_id
    return jwt.encode(claims, TEST_APP_KEY, algorithm="EdDSA")
