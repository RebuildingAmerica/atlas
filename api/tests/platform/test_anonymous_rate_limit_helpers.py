"""Anonymous rate-limit tests for helper functions and cache internals."""

from __future__ import annotations

import hashlib
import sys
from collections import deque
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest

from atlas.platform.http import anonymous_rate_limit_support
from atlas.platform.http.anonymous_rate_limit import (
    AnonymousRateLimitMiddleware,
    _ApiKeyCacheEntry,
    _BucketSpec,
    _forwarded_client_ip,
    _InvalidBearerCacheEntry,
    _path_group,
    _SlidingWindowLimiter,
)
from tests.support.anonymous_rate_limit import (
    EXPECTED_CACHE_ENTRIES_AFTER_PRE_INSERT_PRUNE,
    MINUTE_SECONDS,
    _settings,
)

if TYPE_CHECKING:
    from atlas.domains.access import ApiKeyPrincipal


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


def test_bearer_cache_prunes_expired_entries_before_bounded_insert(db_url: str) -> None:
    """Bearer cache cleanup should bound fake credential cardinality."""

    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=_settings(db_url))
    middleware._bearer_cache = {  # noqa: SLF001
        "expired": _InvalidBearerCacheEntry(expires_at=1.0),
        **{
            f"key-{index}": _InvalidBearerCacheEntry(expires_at=1000.0 + index)
            for index in range(10_000)
        },
    }

    middleware._prune_bearer_cache(2.0)  # noqa: SLF001
    bearer_cache = middleware._bearer_cache  # noqa: SLF001

    assert "expired" not in bearer_cache
    assert "key-0" not in bearer_cache
    assert len(bearer_cache) == EXPECTED_CACHE_ENTRIES_AFTER_PRE_INSERT_PRUNE


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


def test_sliding_window_limiter_uses_window_size_for_empty_retry_after() -> None:
    """An empty bucket should fall back to its configured window size."""
    retry_after = _SlidingWindowLimiter._retry_after(  # noqa: SLF001
        [], now=0.0, window_seconds=MINUTE_SECONDS
    )
    assert retry_after == MINUTE_SECONDS


def test_sliding_window_limiter_prunes_overflow_buckets() -> None:
    """Long-lived workers should trim the oldest tracked buckets when overflowing."""
    limiter = _SlidingWindowLimiter()

    limiter._events = {  # noqa: SLF001
        ("client-a", "minute"): deque([0.0]),
        ("client-b", "minute"): deque([0.0]),
        ("client-c", "minute"): deque([0.0]),
    }
    limiter._bucket_windows = {"minute": 3600}  # noqa: SLF001

    with patch("atlas.platform.http.anonymous_rate_limit._MAX_TRACKED_RATE_LIMIT_BUCKETS", 2):
        limiter._prune_stale_buckets(0.0)  # noqa: SLF001

    assert len(limiter._events) == 2  # noqa: SLF001, PLR2004
    assert ("client-a", "minute") not in limiter._events  # noqa: SLF001


def test_max_tracked_rate_limit_buckets_falls_back_without_public_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delitem(sys.modules, "atlas.platform.http.anonymous_rate_limit", raising=False)

    assert (
        anonymous_rate_limit_support._max_tracked_rate_limit_buckets()  # noqa: SLF001
        == anonymous_rate_limit_support._MAX_TRACKED_RATE_LIMIT_BUCKETS  # noqa: SLF001
    )


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"x-api-key": "abc", "authorization": "Bearer token"}, "multiple"),
        ({"x-api-key": "abc"}, "api_key"),
        ({"authorization": "Bearer token"}, "bearer"),
        ({"authorization": "Token token"}, "authorization"),
        ({}, "none"),
    ],
)
def test_credential_kind_handles_all_header_shapes(
    headers: dict[str, str],
    expected: str,
) -> None:
    """Credential classification should stay explicit for logging and routing."""
    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=_settings("sqlite:///"))
    request = SimpleNamespace(headers=headers)
    assert middleware._credential_kind(request) == expected  # noqa: SLF001


@pytest.mark.parametrize(
    ("header_value", "trusted_proxy_hops", "expected"),
    [
        (None, 1, None),
        ("garbage, still garbage", 1, None),
        ("198.51.100.10, 10.0.0.1", 1, "198.51.100.10"),
        ("198.51.100.10, 10.0.0.1", 0, "10.0.0.1"),
    ],
)
def test_forwarded_client_ip_honors_proxy_hop_policy(
    header_value: str | None,
    trusted_proxy_hops: int,
    expected: str | None,
) -> None:
    """Forwarded-for parsing should only trust configured hops."""
    assert _forwarded_client_ip(header_value, trusted_proxy_hops=trusted_proxy_hops) == expected


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/mcp", "/mcp/*"),
        ("/api/orgs/local/entries", "/api/*"),
        ("/health", "/health"),
    ],
)
def test_path_group_collapses_api_and_mcp_paths(path: str, expected: str) -> None:
    """Rate-limit logs should bucket common API surfaces consistently."""
    assert _path_group(path) == expected


@pytest.mark.asyncio
async def test_has_valid_api_key_removes_expired_cache_entries(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Expired cache entries should be replaced after a fresh API-key lookup."""
    settings = _settings(db_url)
    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=settings)
    cache_key = hashlib.sha256(b"expired").hexdigest()
    middleware._api_key_cache = {  # noqa: SLF001
        cache_key: _ApiKeyCacheEntry(principal=None, expires_at=1.0),
    }
    request = SimpleNamespace(
        headers={"x-api-key": "expired"},
        state=SimpleNamespace(),
    )

    async def fake_verify_api_key(api_key: str, _settings: object) -> ApiKeyPrincipal | None:
        assert api_key == "expired"
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=2.0):
        assert await middleware._has_valid_api_key(request) is False  # noqa: SLF001

    cached = middleware._api_key_cache[cache_key]  # noqa: SLF001
    assert cached.principal is None
    current_time = 2.0
    assert cached.expires_at > current_time


def test_has_valid_bearer_removes_expired_cache_entries(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Expired bearer results should be replaced after fresh JWT verification."""
    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=_settings(db_url))
    authorization = "Bearer refreshed"
    cache_key = hashlib.sha256(authorization.encode()).hexdigest()
    middleware._bearer_cache = {  # noqa: SLF001
        cache_key: _InvalidBearerCacheEntry(expires_at=1.0),
    }
    request = SimpleNamespace(headers={"authorization": authorization})

    def fake_verify_bearer_jwt(value: str | None, **_kwargs: object) -> dict[str, str] | None:
        assert value == authorization
        return {"sub": "user-123"}

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_bearer_jwt",
        fake_verify_bearer_jwt,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=2.0):
        assert middleware._has_valid_bearer(request) is True  # noqa: SLF001

    assert cache_key not in middleware._bearer_cache  # noqa: SLF001


@pytest.mark.asyncio
async def test_has_valid_api_key_logs_and_handles_lookup_errors(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Lookup failures should fail closed instead of letting anonymous traffic through."""
    settings = _settings(db_url)
    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=settings)
    request = SimpleNamespace(headers={"x-api-key": "broken"}, state=SimpleNamespace())

    async def boom(_api_key: str, _settings: object) -> ApiKeyPrincipal | None:
        raise RuntimeError

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        boom,
        raising=False,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=2.0):
        assert await middleware._has_valid_api_key(request) is False  # noqa: SLF001


@pytest.mark.asyncio
async def test_authenticated_internal_actor_bypasses_anonymous_limit_checks(
    db_url: str,
) -> None:
    """Trusted app-to-API traffic should be recognized before anonymous billing."""
    settings = _settings(db_url)
    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=settings)
    request = SimpleNamespace(
        headers={
            "x-atlas-actor-email": "operator@atlas.test",
            "x-atlas-actor-id": "user-123",
            "x-atlas-internal-secret": "internal-test-secret",
        }
    )

    assert await middleware._is_authenticated_request(request) is True  # noqa: SLF001


def test_client_key_falls_back_to_direct_host_when_forwarded_headers_fail(db_url: str) -> None:
    """Direct traffic should use the peer address when proxy hints are unusable."""
    settings = _settings(db_url, trust_unsigned_forward_headers=True)
    middleware = AnonymousRateLimitMiddleware(app=AsyncMock(), settings=settings)
    request = SimpleNamespace(
        headers={"x-forwarded-for": "garbage"}, client=SimpleNamespace(host="203.0.113.10")
    )

    assert middleware._client_key(request) == "direct:203.0.113.10"  # noqa: SLF001
