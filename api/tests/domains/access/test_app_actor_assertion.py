"""The app proves who it acts for with a short-lived signed assertion, not a shared secret."""

from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

from atlas.domains.access.app_assertion import (
    APP_ACTOR_AUDIENCE,
    MAX_ASSERTION_LIFETIME_SECONDS,
    verify_app_actor_assertion,
)
from tests.support.app_assertions import TEST_APP_ISSUER, TEST_APP_JWKS_URL, TEST_APP_KEY

ISSUER = TEST_APP_ISSUER
JWKS_URL = TEST_APP_JWKS_URL
HTTP_OK = 200
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403

_OTHER_KEY = Ed25519PrivateKey.generate()


def _assertion(*, key: Ed25519PrivateKey = TEST_APP_KEY, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": ISSUER,
        "aud": APP_ACTOR_AUDIENCE,
        "sub": "user_editor",
        "email": "Editor@RebuildingUS.org",
        "account_ready": True,
        "org_id": "org_1",
        "iat": now,
        "exp": now + 60,
    }
    claims.update(overrides)
    claims = {name: value for name, value in claims.items() if value is not None}
    return jwt.encode(claims, key, algorithm="EdDSA")


def _verify(token: str) -> object:
    return verify_app_actor_assertion(token, issuer=ISSUER, jwks_url=JWKS_URL)


def test_a_valid_assertion_names_the_signed_in_person_and_their_session() -> None:
    actor = _verify(_assertion())

    assert actor.user_id == "user_editor"
    assert actor.email == "Editor@RebuildingUS.org"
    assert actor.auth_type == "internal"
    assert actor.account_ready is True
    assert actor.org_id == "org_1"


def test_readiness_is_only_true_when_the_claim_is_exactly_true() -> None:
    for value in (False, "true", 1, None):
        assert _verify(_assertion(account_ready=value)).account_ready is False


def test_an_assertion_without_a_workspace_carries_none() -> None:
    assert _verify(_assertion(org_id=None)).org_id is None


@pytest.mark.parametrize(
    "token_factory",
    [
        pytest.param(lambda: _assertion(key=_OTHER_KEY), id="forged signature"),
        pytest.param(lambda: _assertion(aud="https://atlas.example/mcp"), id="customer audience"),
        pytest.param(lambda: _assertion(iss="https://evil.example"), id="wrong issuer"),
        pytest.param(
            lambda: _assertion(iat=int(time.time()) - 600, exp=int(time.time()) - 300),
            id="expired",
        ),
        pytest.param(
            lambda: _assertion(exp=int(time.time()) + MAX_ASSERTION_LIFETIME_SECONDS + 600),
            id="lives too long",
        ),
        pytest.param(lambda: _assertion(sub=None), id="no subject"),
        pytest.param(lambda: _assertion(email=None), id="no email"),
        pytest.param(lambda: _assertion(iat=None), id="no issue time"),
        pytest.param(lambda: "not-a-jwt", id="garbage"),
    ],
)
def test_untrustworthy_assertions_are_rejected(token_factory: object) -> None:
    with pytest.raises(HTTPException) as exc:
        _verify(token_factory())

    assert exc.value.status_code == HTTP_UNAUTHORIZED
    assert exc.value.detail == "The app's identity assertion is not valid."


def test_an_unsigned_assertion_is_rejected() -> None:
    token = jwt.encode(
        {"iss": ISSUER, "aud": APP_ACTOR_AUDIENCE, "sub": "u", "email": "e@x.org"},
        key=None,
        algorithm="none",
    )

    with pytest.raises(HTTPException):
        _verify(token)


def test_verification_requires_a_configured_issuer() -> None:
    with pytest.raises(HTTPException):
        verify_app_actor_assertion(_assertion(), issuer="", jwks_url=JWKS_URL)


@pytest.mark.asyncio
async def test_the_operator_acts_through_a_signed_assertion(
    test_client: object,
    test_settings: object,
) -> None:
    from tests.support.staff_auth import enable_staff_auth

    headers = enable_staff_auth(test_settings)

    response = await test_client.get("/api/review-queue", headers=headers.staff)

    assert response.status_code == HTTP_OK


@pytest.mark.asyncio
async def test_holding_the_shared_secret_no_longer_makes_anyone_the_operator(
    test_client: object,
    test_settings: object,
) -> None:
    """A leaked internal secret can no longer approve profiles or read reporter notes."""
    from tests.support.staff_auth import INTERNAL_TEST_SECRET, STAFF_EMAIL, enable_staff_auth

    enable_staff_auth(test_settings)
    secret_headers = {
        "X-Atlas-Internal-Secret": INTERNAL_TEST_SECRET,
        "X-Atlas-Actor-Id": "user_editor",
        "X-Atlas-Actor-Email": STAFF_EMAIL,
        "X-Atlas-Actor-Account-Ready": "true",
    }

    read = await test_client.get("/api/review-queue", headers=secret_headers)
    decide = await test_client.post("/api/review-queue/missing/approve", headers=secret_headers)

    assert read.status_code == HTTP_FORBIDDEN
    assert decide.status_code == HTTP_FORBIDDEN


@pytest.mark.asyncio
async def test_a_bad_assertion_is_refused_rather_than_ignored(
    test_client: object,
    test_settings: object,
) -> None:
    from tests.support.staff_auth import INTERNAL_TEST_SECRET, enable_staff_auth

    enable_staff_auth(test_settings)

    response = await test_client.get(
        "/api/review-queue",
        headers={
            "X-Atlas-Actor-Assertion": "forged",
            "X-Atlas-Internal-Secret": INTERNAL_TEST_SECRET,
            "X-Atlas-Actor-Id": "user_editor",
            "X-Atlas-Actor-Email": "editor@rebuildingus.org",
        },
    )

    assert response.status_code == HTTP_UNAUTHORIZED
