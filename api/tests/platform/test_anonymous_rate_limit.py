"""Anonymous request rate-limit tests."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING
from unittest.mock import patch

import httpx
import pytest

from atlas.domains.access import ApiKeyPrincipal
from atlas.domains.access.membership import MembershipResult
from atlas.main import create_app
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.anonymous_rate_limit import (
    AnonymousRateLimitMiddleware,
    _ApiKeyCacheEntry,
    _BucketSpec,
    _SlidingWindowLimiter,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

MINUTE_SECONDS = 60
EXPECTED_CACHE_ENTRIES_AFTER_PRE_INSERT_PRUNE = 9_999


def _settings(db_url: str, **overrides: object) -> Settings:
    """Build settings with low anonymous limits for focused middleware tests."""
    values: dict[str, object] = {
        "database_url": db_url,
        "deploy_mode": "local",
        "anonymous_rate_limit_reads_per_minute": 2,
        "anonymous_rate_limit_writes_per_minute": 1,
        "anonymous_rate_limit_total_per_hour": 100,
        "auth_internal_secret": "internal-test-secret",
    }
    values.update(overrides)
    return Settings(**values)


async def _client(
    settings: Settings,
    *,
    host: str = "203.0.113.10",
) -> AsyncIterator[httpx.AsyncClient]:
    """Yield an ASGI client whose peer address can be varied per test."""
    with patch("atlas.main.get_settings", return_value=settings):
        app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    transport = httpx.ASGITransport(app=app, client=(host, 12345))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.asyncio
async def test_anonymous_public_reads_are_limited_per_client(db_url: str) -> None:
    """Anonymous reads should return 429 once the minute bucket is empty."""
    with (
        patch(
            "atlas.platform.http.anonymous_rate_limit.time.time",
            return_value=1_700_000_000.0,
        ),
        patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0),
    ):
        async for client in _client(_settings(db_url)):
            first = await client.get("/openapi.json")
            second = await client.get("/openapi.json")
            blocked = await client.get("/openapi.json")

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.json() == {"detail": "Too many requests."}
    assert blocked.headers["cache-control"] == "no-store"
    assert blocked.headers["retry-after"] == "60"
    assert blocked.headers["x-ratelimit-limit"] == "2"
    assert blocked.headers["x-ratelimit-remaining"] == "0"
    assert blocked.headers["x-ratelimit-reset"] == "1700000060"


@pytest.mark.asyncio
async def test_rate_limit_logs_privacy_safe_operator_event(
    db_url: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Operators should see rate-limit events without raw client addresses."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings, host="203.0.113.10"):
            await client.get("/openapi.json")
            blocked = await client.get("/openapi.json")

    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    matching_records = [
        record
        for record in caplog.records
        if getattr(record, "event", "") == "anonymous_rate_limited"
    ]
    assert len(matching_records) == 1
    record = matching_records[0]
    assert record.layer == "api"
    assert record.bucket == "read-minute"
    assert record.method == "GET"
    assert record.path_group == "/openapi.json"
    assert record.retry_after_seconds == MINUTE_SECONDS
    assert isinstance(record.client_key_hash, str)
    assert "203.0.113.10" not in caplog.text


@pytest.mark.asyncio
async def test_zero_limit_blocks_cleanly(db_url: str) -> None:
    """A zero-valued bucket should intentionally block without crashing."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=0)

    async for client in _client(settings):
        blocked = await client.get("/openapi.json")

    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["retry-after"] == "60"
    assert blocked.headers["x-ratelimit-limit"] == "0"


@pytest.mark.asyncio
async def test_anonymous_public_writes_are_limited_separately(db_url: str) -> None:
    """Anonymous writes should use a tighter minute bucket than public reads."""
    async for client in _client(_settings(db_url)):
        first = await client.post("/api/entity-flags", json={})
        blocked = await client.post("/api/entity-flags", json={})

    assert first.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"


@pytest.mark.asyncio
async def test_anonymous_total_hourly_bucket_limits_wrapping(db_url: str) -> None:
    """The hourly bucket should cap sustained anonymous wrapping traffic."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=100,
        anonymous_rate_limit_total_per_hour=2,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings):
            first = await client.get("/openapi.json")
            second = await client.get("/openapi.json")
            blocked = await client.get("/openapi.json")

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["retry-after"] == "3600"
    assert blocked.headers["x-ratelimit-limit"] == "2"


@pytest.mark.asyncio
async def test_anonymous_limits_are_keyed_by_client_address(db_url: str) -> None:
    """One abusive client should not consume another client's anonymous bucket."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for first_client in _client(settings, host="203.0.113.10"):
        first = await first_client.get("/openapi.json")
        blocked = await first_client.get("/openapi.json")
    async for second_client in _client(settings, host="198.51.100.20"):
        second = await second_client.get("/openapi.json")

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert second.status_code == HTTPStatus.OK


@pytest.mark.asyncio
async def test_health_and_oauth_metadata_are_not_limited(db_url: str) -> None:
    """Health and OAuth discovery metadata must stay reachable during throttling."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        health_responses = [await client.get("/health") for _ in range(3)]
        metadata_responses = [
            await client.get("/api/.well-known/oauth-protected-resource") for _ in range(3)
        ]

    assert [response.status_code for response in health_responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]
    assert [response.status_code for response in metadata_responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]


@pytest.mark.asyncio
async def test_disabled_rate_limit_and_options_requests_pass_through(db_url: str) -> None:
    """Operators should be able to disable the middleware without blocking CORS preflight."""
    disabled_settings = _settings(
        db_url,
        anonymous_rate_limit_enabled=False,
        anonymous_rate_limit_reads_per_minute=0,
    )
    enabled_settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=0)

    async for client in _client(disabled_settings):
        disabled_response = await client.get("/openapi.json")
    async for client in _client(enabled_settings):
        options_response = await client.options("/openapi.json")

    assert disabled_response.status_code == HTTPStatus.OK
    assert options_response.status_code != HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_internal_app_requests_bypass_anonymous_limits(db_url: str) -> None:
    """Trusted app-to-API actor requests should not spend anonymous buckets."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)
    headers = {
        "X-Atlas-Actor-Email": "operator@atlas.test",
        "X-Atlas-Actor-Id": "user-123",
        "X-Atlas-Internal-Secret": "internal-test-secret",
    }

    async for client in _client(settings):
        responses = [await client.get("/openapi.json", headers=headers) for _ in range(3)]

    assert [response.status_code for response in responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]


@pytest.mark.asyncio
async def test_wrong_internal_secret_does_not_bypass_anonymous_limits(db_url: str) -> None:
    """A forged internal actor header should still spend the anonymous bucket."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)
    headers = {
        "X-Atlas-Actor-Email": "operator@atlas.test",
        "X-Atlas-Actor-Id": "user-123",
        "X-Atlas-Internal-Secret": "wrong-secret",
    }

    async for client in _client(settings):
        first = await client.get("/openapi.json", headers=headers)
        blocked = await client.get("/openapi.json", headers=headers)

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_valid_jwt_bypasses_and_fake_bearer_counts_as_anonymous(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only verified OAuth JWTs should bypass anonymous buckets."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    def fake_verify(authorization: str | None, **_kwargs: object) -> dict[str, object] | None:
        if authorization == "Bearer valid-token":
            return {"sub": "user-123"}
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_bearer_jwt",
        fake_verify,
    )

    async for client in _client(settings):
        valid_responses = [
            await client.get("/openapi.json", headers={"Authorization": "Bearer valid-token"})
            for _ in range(2)
        ]
        first_fake = await client.get("/openapi.json", headers={"Authorization": "Bearer fake"})
        second_fake = await client.get("/openapi.json", headers={"Authorization": "Bearer fake"})

    assert [response.status_code for response in valid_responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]
    assert first_fake.status_code == HTTPStatus.OK
    assert second_fake.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_fake_api_key_is_pre_auth_limited_before_repeated_introspection(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Forged API keys should not force repeated upstream introspection work."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=100,
        anonymous_credential_rate_limit_per_minute=1,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_keys: list[str] = []

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        attempted_keys.append(api_key)
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings):
            first = await client.get("/openapi.json", headers={"X-API-Key": "fake-key"})
            blocked = await client.get("/openapi.json", headers={"X-API-Key": "fake-key"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"
    assert attempted_keys == ["fake-key"]
    invalid_records = [
        record
        for record in caplog.records
        if getattr(record, "event", "") == "invalid_credential_attempt"
    ]
    assert len(invalid_records) == 1
    assert invalid_records[0].credential_kind == "api_key"
    assert invalid_records[0].path_group == "/openapi.json"
    assert isinstance(invalid_records[0].client_key_hash, str)
    assert "fake-key" not in caplog.text


@pytest.mark.asyncio
async def test_fake_api_key_spends_anonymous_quota_after_failed_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Forged API keys should still spend anonymous public quota."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=1,
        anonymous_credential_rate_limit_per_minute=10,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_keys: list[str] = []

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        attempted_keys.append(api_key)
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings):
            first = await client.get("/openapi.json", headers={"X-API-Key": "fake-key"})
            blocked = await client.get("/openapi.json", headers={"X-API-Key": "fake-key"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"
    assert attempted_keys == ["fake-key"]


@pytest.mark.asyncio
async def test_fake_bearer_is_pre_auth_limited_before_repeated_jwt_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Forged bearer tokens should not force repeated JWT verification work."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=100,
        anonymous_credential_rate_limit_per_minute=1,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_authorizations: list[str | None] = []

    def fake_verify_bearer_jwt(
        authorization: str | None,
        **_kwargs: object,
    ) -> dict[str, object] | None:
        attempted_authorizations.append(authorization)
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_bearer_jwt",
        fake_verify_bearer_jwt,
    )

    async for client in _client(settings):
        first = await client.get("/openapi.json", headers={"Authorization": "Bearer fake"})
        blocked = await client.get("/openapi.json", headers={"Authorization": "Bearer fake"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"
    assert attempted_authorizations == ["Bearer fake"]
    invalid_records = [
        record
        for record in caplog.records
        if getattr(record, "event", "") == "invalid_credential_attempt"
    ]
    assert len(invalid_records) == 1
    assert invalid_records[0].credential_kind == "bearer"
    assert invalid_records[0].path_group == "/openapi.json"
    assert "Bearer fake" not in caplog.text


@pytest.mark.asyncio
async def test_valid_api_key_bypasses_anonymous_limits(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Valid API-key integrations should not be treated as anonymous wrappers."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_credential_rate_limit_per_minute=10,
        anonymous_credential_rate_limit_total_per_hour=100,
        anonymous_rate_limit_writes_per_minute=1,
    )

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["write"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    async def fake_verify_org_membership(
        user_id: str,
        org_id: str,
        _settings: Settings,
    ) -> MembershipResult:
        assert user_id == "user_123"
        assert org_id == "org_123"
        return MembershipResult(
            role="owner",
            slug="org-123",
            name="Org 123",
            workspace_type="team",
            active_products=["atlas_team"],
        )

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )
    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)
    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_org_membership",
        fake_verify_org_membership,
    )

    payload = {
        "location_query": "Gary, IN",
        "state": "IN",
        "issue_areas": ["housing_affordability"],
    }
    async for client in _client(settings):
        first = await client.post(
            "/api/discovery-runs",
            headers={"X-API-Key": "atlas_test_key"},
            json=payload,
        )
        second = await client.post(
            "/api/discovery-runs",
            headers={"X-API-Key": "atlas_test_key"},
            json=payload,
        )

    assert first.status_code == HTTPStatus.ACCEPTED
    assert second.status_code == HTTPStatus.ACCEPTED


@pytest.mark.asyncio
async def test_unsigned_proxy_client_headers_cannot_change_limit_identity(db_url: str) -> None:
    """Attackers should not evade limits by spoofing Atlas proxy identity headers."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get("/openapi.json", headers={"X-Atlas-Client-IP": "203.0.113.20"})
        blocked = await client.get("/openapi.json", headers={"X-Atlas-Client-IP": "198.51.100.30"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_invalid_signed_proxy_client_ip_falls_back_to_direct_client(db_url: str) -> None:
    """A valid proxy secret still needs a parseable client IP before it affects identity."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "not-an-ip",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        blocked = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "also-not-an-ip",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_signed_proxy_secret_without_client_ip_falls_back_to_direct_client(
    db_url: str,
) -> None:
    """A proxy signature without a client IP should not create a trusted bucket."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={"X-Atlas-Proxy-Secret": "internal-test-secret"},
        )
        blocked = await client.get(
            "/openapi.json",
            headers={"X-Atlas-Proxy-Secret": "internal-test-secret"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_wrong_proxy_secret_does_not_unlock_proxy_identity(db_url: str) -> None:
    """A spoofed proxy secret should behave the same as an unsigned proxy header."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "wrong-secret",
            },
        )
        blocked = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "198.51.100.30",
                "X-Atlas-Proxy-Secret": "wrong-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_forwarded_for_identity_honors_trusted_proxy_hops(db_url: str) -> None:
    """Direct API requests should use the configured forwarded-for hop policy."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        trust_unsigned_forward_headers=True,
    )

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.1"},
        )
        blocked = await client.get(
            "/openapi.json",
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.2"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_forwarded_for_zero_trusted_hops_uses_rightmost_address(db_url: str) -> None:
    """A zero-hop policy should use the rightmost forwarded-for address."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        trust_unsigned_forward_headers=True,
        trusted_proxy_hops=0,
    )

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.1"},
        )
        blocked = await client.get(
            "/openapi.json",
            headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_malformed_forwarded_for_falls_back_to_direct_client(db_url: str) -> None:
    """Malformed forwarded-for values should not create attacker-controlled buckets."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get("/openapi.json", headers={"X-Forwarded-For": "garbage"})
        blocked = await client.get("/openapi.json", headers={"X-Forwarded-For": "more garbage"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_unsigned_forwarded_for_is_ignored_by_default(db_url: str) -> None:
    """Direct traffic should not get attacker-controlled identities from XFF."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.1"},
        )
        blocked = await client.get(
            "/openapi.json",
            headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.2"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_signed_proxy_client_headers_partition_proxied_clients(db_url: str) -> None:
    """The app proxy should let the API rate-limit real proxied client IPs."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        second = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "198.51.100.30",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK


@pytest.mark.asyncio
async def test_signed_edge_origin_secret_partitions_proxied_clients(db_url: str) -> None:
    """Cloudflare edge headers should be trusted only with the edge origin secret."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        edge_origin_secret="edge-test-secret",
    )

    async for client in _client(settings):
        first = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "edge-test-secret",
            },
        )
        second = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "198.51.100.30",
                "X-Atlas-Proxy-Secret": "edge-test-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK


@pytest.mark.asyncio
async def test_signed_proxy_client_header_normalizes_ipv6_and_ipv4_ports(db_url: str) -> None:
    """Signed proxy client IPs should normalize common proxy header forms."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        ipv6_first = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "[2001:db8::1]",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        ipv6_blocked = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "2001:db8::1",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        port_first = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "203.0.113.20:4321",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        port_blocked = await client.get(
            "/openapi.json",
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )

    assert ipv6_first.status_code == HTTPStatus.OK
    assert ipv6_blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert port_first.status_code == HTTPStatus.OK
    assert port_blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_sliding_window_limiter_prunes_stale_client_buckets() -> None:
    """Expired client buckets should not grow without bound in long-lived workers."""
    limiter = _SlidingWindowLimiter()
    bucket = (_BucketSpec(name="minute", limit=10, window_seconds=60),)

    with patch(
        "atlas.platform.http.anonymous_rate_limit.time.monotonic",
        side_effect=[0.0, 0.0, 0.0, 61.0],
    ):
        await limiter.reserve("client-a", bucket)
        await limiter.reserve("client-b", bucket)
        await limiter.reserve("client-c", bucket)
        await limiter.reserve("client-d", bucket)

    events = limiter._events  # noqa: SLF001
    assert len(events) == 1


def test_api_key_cache_prunes_expired_entries_before_bounded_insert(db_url: str) -> None:
    """API key cache cleanup should bound fake credential cardinality."""

    async def app(_scope: object, _receive: object, _send: object) -> None:
        return None

    middleware = AnonymousRateLimitMiddleware(app, settings=_settings(db_url))
    api_key_cache_seed = {
        "expired": _ApiKeyCacheEntry(principal=None, expires_at=1.0),
        **{
            f"key-{index}": _ApiKeyCacheEntry(principal=None, expires_at=1000.0 + index)
            for index in range(10_000)
        },
    }
    middleware._api_key_cache = api_key_cache_seed  # noqa: SLF001

    middleware._prune_api_key_cache(2.0)  # noqa: SLF001
    api_key_cache = middleware._api_key_cache  # noqa: SLF001

    assert "expired" not in api_key_cache
    assert "key-0" not in api_key_cache
    assert len(api_key_cache) == EXPECTED_CACHE_ENTRIES_AFTER_PRE_INSERT_PRUNE


@pytest.mark.asyncio
async def test_sliding_window_limiter_expires_old_events() -> None:
    """Old bucket entries should be pruned so legitimate users recover."""
    limiter = _SlidingWindowLimiter()
    bucket = (_BucketSpec(name="minute", limit=1, window_seconds=60),)

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", side_effect=[0.0, 61.0]):
        first = await limiter.reserve("client", bucket)
        second = await limiter.reserve("client", bucket)

    assert first.allowed is True
    assert second.allowed is True
