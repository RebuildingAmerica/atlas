"""Anonymous rate-limit tests for public read/write behavior."""

from __future__ import annotations

from http import HTTPStatus
from unittest.mock import patch

import pytest

from tests.support.anonymous_rate_limit import (
    MINUTE_SECONDS,
    OPENAPI_PATH,
    READ_PATH,
    READ_PATH_GROUP,
    _client,
    _settings,
)


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
            first = await client.get(OPENAPI_PATH)
            second = await client.get(OPENAPI_PATH)
            blocked = await client.get(OPENAPI_PATH)

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.json() == {"detail": "Too many requests."}
    assert blocked.headers["cache-control"] == "no-store"
    assert blocked.headers["retry-after"] == str(MINUTE_SECONDS)
    assert blocked.headers["x-ratelimit-limit"] == "2"
    assert blocked.headers["x-ratelimit-remaining"] == "0"
    assert blocked.headers["x-ratelimit-reset"] == f"17000000{MINUTE_SECONDS}"


@pytest.mark.asyncio
async def test_rate_limit_logs_privacy_safe_operator_event(
    db_url: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Operators should see rate-limit events without raw client addresses."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings, host="203.0.113.10"):
            await client.get(READ_PATH)
            blocked = await client.get(READ_PATH)

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
    assert record.path_group == READ_PATH_GROUP
    assert record.retry_after_seconds == MINUTE_SECONDS
    assert isinstance(record.client_key_hash, str)
    assert "203.0.113.10" not in caplog.text


@pytest.mark.asyncio
async def test_zero_limit_blocks_cleanly(db_url: str) -> None:
    """A zero-valued bucket should intentionally block without crashing."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=0)

    async for client in _client(settings):
        blocked = await client.get(READ_PATH)

    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["retry-after"] == str(MINUTE_SECONDS)
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
            first = await client.get(READ_PATH)
            second = await client.get(READ_PATH)
            blocked = await client.get(READ_PATH)

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
        first = await first_client.get(READ_PATH)
        blocked = await first_client.get(READ_PATH)
    async for second_client in _client(settings, host="198.51.100.20"):
        second = await second_client.get(READ_PATH)

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
        disabled_response = await client.get(READ_PATH)
    async for client in _client(enabled_settings):
        options_response = await client.options(READ_PATH)

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
        responses = [await client.get(READ_PATH, headers=headers) for _ in range(3)]

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
        first = await client.get(READ_PATH, headers=headers)
        blocked = await client.get(READ_PATH, headers=headers)

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
