"""Hosted auth retains signature checks without synchronous network calls."""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

from atlas.domains.access import app_assertion, cloudflare_access
from atlas.domains.access.jwt import get_jwks_client
from atlas.domains.access.machine import parse_machine_issuers, verify_machine_token
from atlas.domains.discovery.pipeline.source_http import PublicSourceResponse
from atlas.platform.config import Settings
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime
from tests.support.platform_admin import access_certs, access_config, sign_access_token

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping


def test_hosted_actor_signature_and_request_key_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_assertion, "get_jwks_client", get_jwks_client)
    key = Ed25519PrivateKey.generate()
    public = json.loads(jwt.algorithms.OKPAlgorithm.to_jwk(key.public_key()))
    public["kid"] = "one"
    settings = Settings(multi_user=False)
    url = "https://app.example/jwks"
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": "https://app.example",
            "aud": "urn:atlas:app-actor",
            "sub": "person",
            "email": "person@example.com",
            "iat": now,
            "exp": now + 60,
            "account_ready": True,
        },
        key,
        algorithm="EdDSA",
        headers={"kid": "one"},
    )
    runtime = HostedRuntime(settings, AsyncMock(), jwks_documents={url: {"keys": [public]}})
    with bind_hosted_runtime(runtime):
        actor = app_assertion.verify_app_actor_assertion(
            token, issuer="https://app.example", jwks_url=url
        )
        assert actor.user_id == "person"
        assert actor.account_ready
        with bind_hosted_runtime(HostedRuntime(settings, AsyncMock())):
            with pytest.raises(HTTPException) as error:
                app_assertion.verify_app_actor_assertion(
                    token, issuer="https://app.example", jwks_url=url
                )
            assert error.value.status_code == 401
        assert (
            app_assertion.verify_app_actor_assertion(
                token, issuer="https://app.example", jwks_url=url
            )
            == actor
        )


def test_hosted_google_machine_uses_preloaded_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Hosted verification attempted synchronous networking")

    monkeypatch.setattr("urllib.request.urlopen", forbidden)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    public["kid"] = "google"
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": "release-control",
            "email": "release@example.iam.gserviceaccount.com",
            "email_verified": True,
            "iat": now,
            "exp": now + 60,
        },
        key,
        algorithm="RS256",
        headers={"kid": "google"},
    )
    issuers = parse_machine_issuers(
        json.dumps(
            [
                {
                    "kind": "google_oidc",
                    "name": "release",
                    "service_account": "release@example.iam.gserviceaccount.com",
                    "audience": "release-control",
                    "actions": ["machine.runs.trigger_scheduled"],
                }
            ]
        )
    )
    runtime = HostedRuntime(
        Settings(multi_user=False),
        AsyncMock(),
        jwks_documents={"https://www.googleapis.com/oauth2/v3/certs": {"keys": [public]}},
    )
    with bind_hosted_runtime(runtime):
        principal = verify_machine_token(token, issuers)
        assert principal is not None
        assert principal.actions == frozenset({"machine.runs.trigger_scheduled"})
    with bind_hosted_runtime(HostedRuntime(runtime.settings, AsyncMock())):
        assert verify_machine_token(token, issuers) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "payload", "expected"),
    [
        (200, json.dumps(access_certs()).encode(), None),
        (302, b"{}", ValueError),
        (200, b"x" * 65537, ValueError),
        (200, b"[]", TypeError),
    ],
    ids=["valid", "redirect", "oversize", "not-object"],
)
async def test_access_uses_bounded_hosted_transport(
    status: int, payload: bytes, expected: type[Exception] | None
) -> None:
    closed = []

    @asynccontextmanager
    async def fetch(url: str, headers: Mapping[str, str]) -> AsyncIterator[PublicSourceResponse]:
        assert url == access_config().certs_url
        assert dict(headers) == {"Accept": "application/json"}

        async def body() -> AsyncIterator[bytes]:
            yield payload

        try:
            yield PublicSourceResponse(status, {}, body())
        finally:
            closed.append(True)

    with bind_hosted_runtime(
        HostedRuntime(Settings(multi_user=False), AsyncMock(), public_source_fetch=fetch)
    ):
        if expected is None:
            verifier = cloudflare_access.CloudflareAccessVerifier(access_config())
            result = await verifier.verify(sign_access_token())
            assert result.identity is not None
        else:
            with pytest.raises(expected):
                await cloudflare_access._fetch_certs(access_config().certs_url)  # noqa: SLF001
    assert closed == [True]


@pytest.mark.asyncio
async def test_access_refuses_missing_hosted_transport() -> None:
    with (
        bind_hosted_runtime(HostedRuntime(Settings(multi_user=False), AsyncMock())),
        pytest.raises(RuntimeError, match="transport"),
    ):
        await cloudflare_access._fetch_certs(access_config().certs_url)  # noqa: SLF001
