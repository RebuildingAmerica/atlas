"""The API's own check of the operator's Cloudflare Access sign-in."""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from atlas.domains.access import cloudflare_access
from atlas.domains.access.cloudflare_access import (
    AccessConfig,
    CloudflareAccessVerifier,
    access_verifier_for,
    parse_access_config,
)
from tests.support.platform_admin import (
    ACCESS_AUD,
    ACCESS_KEY,
    ACCESS_KID,
    ACCESS_TEAM_DOMAIN,
    OPERATOR_EMAIL,
    access_certs,
    access_config,
    sign_access_token,
)

OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _Certs:
    """A stand-in for the team's certs endpoint that counts fetches."""

    def __init__(self, *keys: tuple[str, rsa.RSAPrivateKey]) -> None:
        self.keys = keys
        self.fetches = 0
        self.fail = False

    async def __call__(self, url: str) -> dict[str, Any]:
        assert url == f"https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs"
        self.fetches += 1
        if self.fail:
            msg = "certs unavailable"
            raise httpx.ConnectError(msg)
        return access_certs(*self.keys)


class _Clock:
    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now


def _verifier(certs: _Certs | None = None, clock: _Clock | None = None) -> CloudflareAccessVerifier:
    return CloudflareAccessVerifier(
        access_config(),
        fetch_certs=certs or _Certs(),
        clock=clock or _Clock(),
    )


class TestParseAccessConfig:
    def test_neither_setting_means_not_configured(self) -> None:
        assert parse_access_config("", "  ") is None

    def test_normalizes_the_team_domain(self) -> None:
        config = parse_access_config(f" HTTPS://{ACCESS_TEAM_DOMAIN.upper()}/ ", ACCESS_AUD)

        assert config == AccessConfig(team_domain=ACCESS_TEAM_DOMAIN, audience=ACCESS_AUD)
        assert config.issuer == f"https://{ACCESS_TEAM_DOMAIN}"

    @pytest.mark.parametrize(
        ("domain", "audience", "message"),
        [
            ("", ACCESS_AUD, "ATLAS_ACCESS_TEAM_DOMAIN is required"),
            (ACCESS_TEAM_DOMAIN, "", "ATLAS_ACCESS_AUD is required"),
            ("atlas.example.org", ACCESS_AUD, "cloudflareaccess.com host"),
            (ACCESS_TEAM_DOMAIN, "not-a-tag", "64-character"),
        ],
    )
    def test_refuses_half_set_or_malformed_settings(
        self, domain: str, audience: str, message: str
    ) -> None:
        with pytest.raises(ValueError, match=message):
            parse_access_config(domain, audience)


class TestVerify:
    async def test_accepts_a_current_token_for_this_team_and_application(self) -> None:
        result = await _verifier().verify(sign_access_token(" Willie@RebuildingUS.org "))

        assert result.identity is not None
        assert result.identity.email == OPERATOR_EMAIL
        assert result.identity.subject == "access-user-id"
        assert result.reason is None

    async def test_accepts_a_string_audience_and_a_token_without_nbf_or_sub(self) -> None:
        claims = {
            "iss": f"https://{ACCESS_TEAM_DOMAIN}",
            "aud": ACCESS_AUD,
            "exp": int(time.time()) + 300,
            "email": OPERATOR_EMAIL,
        }
        token = jwt.encode(claims, ACCESS_KEY, algorithm="RS256", headers={"kid": ACCESS_KID})

        result = await _verifier().verify(token)

        assert result.identity is not None
        assert result.identity.subject == ""

    @pytest.mark.parametrize(
        ("token_factory", "reason"),
        [
            (lambda: "not-a-jwt", "malformed"),
            (lambda: sign_access_token(algorithm="RS512"), "wrong_algorithm"),
            (
                lambda: jwt.encode({"email": OPERATOR_EMAIL}, "k" * 32, algorithm="HS256"),
                "wrong_algorithm",
            ),
            (lambda: sign_access_token(aud=["someone-else"]), "wrong_audience"),
            (lambda: sign_access_token(iss="https://other.cloudflareaccess.com"), "wrong_issuer"),
            (lambda: sign_access_token(exp=int(time.time()) - 1), "expired"),
            (lambda: sign_access_token(exp="soon"), "expired"),
            (lambda: sign_access_token(nbf=int(time.time()) + 600), "not_yet_valid"),
            (lambda: sign_access_token(nbf="later"), "not_yet_valid"),
            (lambda: sign_access_token(None, common_name="ci-token-id"), "service_token"),
            (lambda: sign_access_token(None), "no_email"),
            (lambda: sign_access_token("not-an-email"), "no_email"),
            (lambda: sign_access_token(kid="rotated-away"), "unknown_key"),
            (lambda: sign_access_token(key=OTHER_KEY), "bad_signature"),
        ],
    )
    async def test_refuses(self, token_factory: Any, reason: str) -> None:
        result = await _verifier().verify(token_factory())

        assert result.identity is None
        assert result.reason == reason

    async def test_refuses_a_token_without_a_key_id(self) -> None:
        token = jwt.encode({"email": OPERATOR_EMAIL}, ACCESS_KEY, algorithm="RS256")

        result = await _verifier().verify(token)

        assert result.reason == "wrong_algorithm"

    async def test_refuses_when_the_team_keys_cannot_be_fetched(self) -> None:
        certs = _Certs()
        certs.fail = True

        result = await _verifier(certs).verify(sign_access_token())

        assert result.reason == "key_fetch_failed"


class TestKeyCache:
    async def test_reuses_the_team_keys_for_an_hour(self) -> None:
        certs, clock = _Certs(), _Clock()
        verifier = _verifier(certs, clock)

        await verifier.verify(sign_access_token())
        clock.now += 3599
        await verifier.verify(sign_access_token(exp=int(clock.now) + 60))
        assert certs.fetches == 1

        clock.now += 2
        await verifier.verify(sign_access_token(exp=int(clock.now) + 60))
        assert certs.fetches == 2

    async def test_refetches_an_unknown_key_at_most_once_a_minute(self) -> None:
        certs, clock = _Certs(), _Clock()
        verifier = _verifier(certs, clock)
        await verifier.verify(sign_access_token())

        unknown = sign_access_token(kid="new-key", key=OTHER_KEY)
        assert (await verifier.verify(unknown)).reason == "unknown_key"
        assert certs.fetches == 1

        certs.keys = ((ACCESS_KID, ACCESS_KEY), ("new-key", OTHER_KEY))
        clock.now += 61
        result = await verifier.verify(sign_access_token(kid="new-key", key=OTHER_KEY))

        assert result.identity is not None
        assert certs.fetches == 2

    async def test_skips_published_keys_that_are_not_rsa_or_unnamed(self) -> None:
        async def _certs(_url: str) -> dict[str, Any]:
            published = access_certs()
            published["keys"].extend(
                [{"kty": "EC", "kid": "ec"}, {**published["keys"][0], "kid": ""}, "junk"]
            )
            return published

        verifier = CloudflareAccessVerifier(access_config(), fetch_certs=_certs)

        assert (await verifier.verify(sign_access_token())).identity is not None


async def test_fetches_the_team_certs_over_https(monkeypatch: pytest.MonkeyPatch) -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == f"https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs"
        return httpx.Response(200, json=access_certs())

    real_client = httpx.AsyncClient

    def _client(**kwargs: Any) -> httpx.AsyncClient:
        return real_client(transport=httpx.MockTransport(_handler), **kwargs)

    monkeypatch.setattr(cloudflare_access.httpx, "AsyncClient", _client)

    body = await cloudflare_access._fetch_certs(access_config().certs_url)  # noqa: SLF001

    assert body["keys"][0]["kid"] == ACCESS_KID


async def test_refuses_certs_that_are_not_a_json_object(monkeypatch: pytest.MonkeyPatch) -> None:
    real_client = httpx.AsyncClient

    def _client(**kwargs: Any) -> httpx.AsyncClient:
        transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=["no"]))
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(cloudflare_access.httpx, "AsyncClient", _client)

    with pytest.raises(TypeError, match="JSON object"):
        await cloudflare_access._fetch_certs(access_config().certs_url)  # noqa: SLF001


def test_shares_one_verifier_per_team_and_application() -> None:
    assert access_verifier_for(access_config()) is access_verifier_for(access_config())
