"""Machines prove themselves with credentials scoped to named actions, never as people."""

from __future__ import annotations

import base64
import hashlib
import json
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from atlas.domains.access import machine
from atlas.domains.access.machine import (
    GOOGLE_ISSUER,
    MachinePrincipal,
    parse_machine_issuers,
    verify_machine_token,
)

SCHEDULER_SA = "atlas-scheduler@rap-atlas-prod.iam.gserviceaccount.com"
SCHEDULED_URL = "https://atlas-api.rebuildingus.org/api/discovery-runs/scheduled"
STATIC_KEY = "self-hosted-cron-key-" + "x" * 40  # pragma: allowlist secret

_REAL_GOOGLE_JWKS_CLIENT = machine._google_jwks_client  # noqa: SLF001 - captured before patching
_GOOGLE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_ADMIN_KEY = Ed25519PrivateKey.generate()
_ADMIN_PUBLIC = base64.b64encode(
    _ADMIN_KEY.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
).decode()


@pytest.fixture(autouse=True)
def _google_publishes_the_test_key(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Client:
        def get_signing_key_from_jwt(self, _token: str) -> SimpleNamespace:
            return SimpleNamespace(key=_GOOGLE_KEY.public_key())

    monkeypatch.setattr(machine, "_google_jwks_client", _Client)


def _issuers(*overrides: dict[str, object]) -> str:
    entries: list[dict[str, object]] = [
        {
            "kind": "google_oidc",
            "name": "cloud-scheduler",
            "service_account": SCHEDULER_SA,
            "audience": SCHEDULED_URL,
            "actions": ["machine.runs.trigger_scheduled"],
        },
        {
            "kind": "ed25519_jwt",
            "name": "atlas-admin",
            "issuer": "atlas-admin",
            "audience": "atlas-api",
            "public_key": _ADMIN_PUBLIC,
            "actions": ["platform.discounts.review", "platform.costs.view"],
        },
        {
            "kind": "static_key",
            "name": "self-hosted-cron",
            "key_sha256": hashlib.sha256(STATIC_KEY.encode()).hexdigest(),
            "actions": ["machine.runs.trigger_scheduled"],
        },
    ]
    entries.extend(overrides)
    return json.dumps(entries)


def _google_token(**overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": GOOGLE_ISSUER,
        "aud": SCHEDULED_URL,
        "sub": "1234567890",
        "email": SCHEDULER_SA,
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return jwt.encode(
        {key: value for key, value in claims.items() if value is not None},
        _GOOGLE_KEY,
        algorithm="RS256",
    )


def _admin_token(*, key: Ed25519PrivateKey = _ADMIN_KEY, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": "atlas-admin",
        "aud": "atlas-api",
        "sub": "atlas-admin-worker",
        "act": "willie@rebuildingus.org",
        "iat": now,
        "exp": now + 60,
    }
    claims.update(overrides)
    return jwt.encode(
        {key: value for key, value in claims.items() if value is not None},
        key,
        algorithm="EdDSA",
    )


def test_google_keys_come_from_googles_published_certs_and_are_fetched_once() -> None:
    client = _REAL_GOOGLE_JWKS_CLIENT()

    assert client.uri == "https://www.googleapis.com/oauth2/v3/certs"
    assert _REAL_GOOGLE_JWKS_CLIENT() is client


def test_no_configured_issuers_trusts_no_machine() -> None:
    assert parse_machine_issuers("") == []
    assert verify_machine_token(_google_token(), []) is None


def test_cloud_scheduler_is_trusted_only_for_scheduled_discovery() -> None:
    principal = verify_machine_token(_google_token(), parse_machine_issuers(_issuers()))

    assert principal == MachinePrincipal(
        issuer_name="cloud-scheduler",
        kind="google_oidc",
        subject=SCHEDULER_SA,
        actions=frozenset({"machine.runs.trigger_scheduled"}),
        acting_for=None,
    )


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"aud": "https://atlas-api.rebuildingus.org/api/other"}, id="other audience"),
        pytest.param(
            {"email": "someone@rap-atlas-prod.iam.gserviceaccount.com"}, id="other account"
        ),
        pytest.param({"email_verified": False}, id="unverified email"),
        pytest.param({"email_verified": None}, id="no verification claim"),
        pytest.param({"iss": "https://evil.example"}, id="other issuer"),
        pytest.param({"exp": int(time.time()) - 60}, id="expired"),
    ],
)
def test_google_tokens_for_anything_else_are_not_trusted(overrides: dict[str, object]) -> None:
    assert (
        verify_machine_token(_google_token(**overrides), parse_machine_issuers(_issuers())) is None
    )


def test_the_short_google_issuer_spelling_is_accepted() -> None:
    principal = verify_machine_token(
        _google_token(iss="accounts.google.com"), parse_machine_issuers(_issuers())
    )

    assert principal is not None


def test_the_admin_app_is_trusted_for_its_platform_actions_and_names_the_operator() -> None:
    principal = verify_machine_token(_admin_token(), parse_machine_issuers(_issuers()))

    assert principal == MachinePrincipal(
        issuer_name="atlas-admin",
        kind="ed25519_jwt",
        subject="atlas-admin-worker",
        actions=frozenset({"platform.discounts.review", "platform.costs.view"}),
        acting_for="willie@rebuildingus.org",
    )


@pytest.mark.parametrize(
    "token_factory",
    [
        pytest.param(lambda: _admin_token(key=Ed25519PrivateKey.generate()), id="forged"),
        pytest.param(lambda: _admin_token(aud="someone-else"), id="other audience"),
        pytest.param(
            lambda: _admin_token(exp=int(time.time()) + 3600), id="lives longer than two minutes"
        ),
        pytest.param(lambda: _admin_token(iat=None), id="no issue time"),
        pytest.param(lambda: _admin_token(iss="unknown-app"), id="unknown issuer"),
        pytest.param(lambda: "not.a.jwt", id="garbage"),
    ],
)
def test_admin_tokens_that_fail_any_check_are_not_trusted(token_factory: object) -> None:
    assert verify_machine_token(token_factory(), parse_machine_issuers(_issuers())) is None


def test_a_self_hosted_static_key_is_trusted_by_its_hash() -> None:
    principal = verify_machine_token(STATIC_KEY, parse_machine_issuers(_issuers()))

    assert principal is not None
    assert principal.issuer_name == "self-hosted-cron"
    assert principal.subject == "self-hosted-cron"


def test_a_wrong_static_key_is_not_trusted() -> None:
    assert verify_machine_token(STATIC_KEY + "y", parse_machine_issuers(_issuers())) is None


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        pytest.param(
            "not json", "ATLAS_MACHINE_TRUSTED_ISSUERS must be a JSON list", id="not json"
        ),
        pytest.param(
            '{"kind": "static_key"}',
            "ATLAS_MACHINE_TRUSTED_ISSUERS must be a JSON list",
            id="an object, not a list",
        ),
        pytest.param(
            '[{"kind": "telepathy", "name": "x", "actions": []}]',
            "ATLAS_MACHINE_TRUSTED_ISSUERS",
            id="unknown kind",
        ),
        pytest.param(
            _issuers(
                {
                    "kind": "static_key",
                    "name": "cloud-scheduler",
                    "key_sha256": "a" * 64,
                    "actions": [],
                }
            ),
            "issuer names must be unique",
            id="duplicate names",
        ),
        pytest.param(
            json.dumps(
                [
                    {
                        "kind": "static_key",
                        "name": "x",
                        "key_sha256": "a" * 64,
                        "actions": ["instance.claims.review"],
                    }
                ]
            ),
            "instance.claims.review is not a machine or platform action",
            id="a person's action",
        ),
        pytest.param(
            json.dumps(
                [{"kind": "static_key", "name": "x", "key_sha256": "a" * 64, "actions": ["x.y"]}]
            ),
            "x.y is not a known action",
            id="an unknown action",
        ),
        pytest.param(
            '[{"kind": "static_key", "name": "x", "key_sha256": "short", "actions": []}]',
            "ATLAS_MACHINE_TRUSTED_ISSUERS",
            id="a short digest",
        ),
        pytest.param(
            '[{"kind": "ed25519_jwt", "name": "x", "issuer": "x", "audience": "a", '
            '"public_key": "bm90IGEga2V5", "actions": []}]',
            "public_key must be a base64 Ed25519 public key",
            id="a key that is not Ed25519",
        ),
    ],
)
def test_malformed_issuer_config_fails_at_startup(raw: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        parse_machine_issuers(raw)
