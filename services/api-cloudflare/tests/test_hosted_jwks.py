"""Hosted key lookups use bounded asynchronous transport and request-local keys."""

import asyncio
import importlib
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def token(issuer):
    return jwt.encode({"iss": issuer}, Ed25519PrivateKey.generate(), algorithm="EdDSA")


def settings(origin="https://atlas.example"):
    return SimpleNamespace(
        auth_jwt_issuer=origin + "/api/auth",
        auth_jwt_jwks_url=origin + "/api/auth/jwks",
        machine_trusted_issuers="[]",
    )


@pytest.mark.asyncio
async def test_key_cache_uses_only_configured_origins_and_expires():
    hosted = importlib.import_module("hosted_jwks")
    calls = []
    now = [0]

    @asynccontextmanager
    async def fetch(url, headers):
        calls.append(url)

        async def body():
            yield b'{"keys": []}'

        yield SimpleNamespace(status_code=200, body=body())

    config = settings()
    cache = hosted.HostedJwksCache(config, fetch=fetch, clock=lambda: now[0])
    valid = [(b"x-atlas-actor-assertion", token(config.auth_jwt_issuer).encode())]
    assert await cache.for_headers([]) == {}
    assert (
        await cache.for_headers(
            [(b"authorization", b"Bearer " + token("https://evil.example").encode())]
        )
        == {}
    )
    first, second = await asyncio.gather(
        cache.for_headers(valid), cache.for_headers(valid)
    )
    assert first == second == {config.auth_jwt_jwks_url: {"keys": []}}
    assert calls == [config.auth_jwt_jwks_url]
    now[0] = 61
    await cache.for_headers(valid)
    assert calls == [config.auth_jwt_jwks_url] * 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,body",
    [(302, b"{}"), (200, b"[]"), (200, b"x" * 65537)],
    ids=["redirect", "not-object", "too-large"],
)
async def test_key_fetch_fails_closed_and_throttles_retries(status, body):
    hosted = importlib.import_module("hosted_jwks")
    calls = []

    @asynccontextmanager
    async def fetch(url, headers):
        calls.append(url)

        async def chunks():
            yield body

        yield SimpleNamespace(status_code=status, body=chunks())

    config = settings()
    cache = hosted.HostedJwksCache(config, fetch=fetch)
    headers = [(b"authorization", b"Bearer " + token(config.auth_jwt_issuer).encode())]
    assert await cache.for_headers(headers) == {}
    assert await cache.for_headers(headers) == {}
    assert calls == [config.auth_jwt_jwks_url]


def test_hosted_verification_never_opens_synchronous_network(monkeypatch):
    from atlas.domains.access.jwt import get_jwks_client
    from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime

    key = Ed25519PrivateKey.generate()
    public = json.loads(jwt.algorithms.OKPAlgorithm.to_jwk(key.public_key()))
    public["kid"] = "one"
    config = settings()
    signed = jwt.encode(
        {"sub": "reader"}, key, algorithm="EdDSA", headers={"kid": "one"}
    )

    def forbidden(*args, **kwargs):
        pytest.fail("Hosted verification attempted synchronous network I/O")

    monkeypatch.setattr("urllib.request.urlopen", forbidden)
    with bind_hosted_runtime(
        HostedRuntime(
            config,
            forbidden,
            jwks_documents={config.auth_jwt_jwks_url: {"keys": [public]}},
        )
    ):
        assert (
            jwt.decode(
                signed,
                get_jwks_client(config.auth_jwt_jwks_url)
                .get_signing_key_from_jwt(signed)
                .key,
                algorithms=["EdDSA"],
            )["sub"]
            == "reader"
        )
        with pytest.raises(jwt.PyJWKClientError):
            get_jwks_client("https://other.example/jwks").get_signing_key_from_jwt(
                signed
            )


@pytest.mark.asyncio
async def test_cancelled_key_fetch_releases_resources_and_does_not_poison_cache():
    hosted = importlib.import_module("hosted_jwks")
    started, finish = asyncio.Event(), asyncio.Event()
    closed = []

    @asynccontextmanager
    async def fetch(url, headers):
        async def chunks():
            started.set()
            await finish.wait()
            yield b'{"keys": []}'

        try:
            yield SimpleNamespace(status_code=200, body=chunks())
        finally:
            closed.append(True)

    config = settings()
    cache = hosted.HostedJwksCache(config, fetch=fetch)
    headers = [(b"x-atlas-actor-assertion", token(config.auth_jwt_issuer).encode())]
    pending = asyncio.create_task(cache.for_headers(headers))
    await started.wait()
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert closed == [True]
    finish.set()
    assert await cache.for_headers(headers) == {config.auth_jwt_jwks_url: {"keys": []}}
    assert closed == [True, True]
