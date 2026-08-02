"""Support helpers for anonymous request admission control."""

from __future__ import annotations

import asyncio
import hashlib
import sys
import time
from collections import deque
from dataclasses import dataclass
from ipaddress import ip_address
from math import ceil
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas.domains.access.principals import ApiKeyPrincipal

_CLIENT_IP_HEADER = "x-atlas-client-ip"
_PROXY_SECRET_HEADER = "x-atlas-proxy-secret"
_INTERNAL_SECRET_HEADER = "x-atlas-internal-secret"
_ACTOR_ID_HEADER = "x-atlas-actor-id"
_ACTOR_EMAIL_HEADER = "x-atlas-actor-email"
_API_KEY_CACHE_TTL_SECONDS = 30
_MAX_API_KEY_CACHE_ENTRIES = 10_000
_MAX_TRACKED_RATE_LIMIT_BUCKETS = 50_000

_EXEMPT_PATHS = frozenset(
    {
        "/health",
        "/api/auth/health",
        "/api/.well-known/oauth-protected-resource",
    }
)
_LIMITED_EXACT_PATHS = frozenset({"/docs", "/openapi.json", "/mcp", "/mcp/"})
_LIMITED_PATH_PREFIXES = ("/api/", "/mcp/")


@dataclass(frozen=True)
class _BucketSpec:
    """One rate-limit bucket definition."""

    name: str
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class _RateLimitResult:
    """Outcome from a bucket reservation attempt."""

    allowed: bool
    bucket_name: str
    limit: int
    remaining: int
    retry_after: int


@dataclass(frozen=True)
class _ApiKeyCacheEntry:
    """Cached API-key verification result."""

    principal: ApiKeyPrincipal | None
    expires_at: float


@dataclass(frozen=True)
class _InvalidBearerCacheEntry:
    """Cached failed bearer-token verification."""

    expires_at: float


class _SlidingWindowLimiter:
    """In-memory sliding-window limiter keyed by anonymous client identity."""

    def __init__(self) -> None:
        self._events: dict[tuple[str, str], deque[float]] = {}
        self._bucket_windows: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def reserve(
        self,
        client_key: str,
        bucket_specs: tuple[_BucketSpec, ...],
    ) -> _RateLimitResult:
        """Reserve one event across all requested buckets."""
        now = time.monotonic()
        async with self._lock:
            for spec in bucket_specs:
                self._bucket_windows[spec.name] = spec.window_seconds
            self._prune_stale_buckets(now)

            for spec in bucket_specs:
                key = (client_key, spec.name)
                timestamps = self._events.get(key)
                if timestamps is None:
                    timestamps = deque()
                    self._events[key] = timestamps
                self._prune(timestamps, now, spec.window_seconds)
                if len(timestamps) >= spec.limit:
                    retry_after = self._retry_after(timestamps, now, spec.window_seconds)
                    return _RateLimitResult(
                        allowed=False,
                        bucket_name=spec.name,
                        limit=spec.limit,
                        remaining=0,
                        retry_after=retry_after,
                    )

            remaining_values: list[int] = []
            retry_values: list[int] = []
            for spec in bucket_specs:
                key = (client_key, spec.name)
                timestamps = self._events[key]
                timestamps.append(now)
                remaining_values.append(max(spec.limit - len(timestamps), 0))
                retry_values.append(self._retry_after(timestamps, now, spec.window_seconds))

            return _RateLimitResult(
                allowed=True,
                bucket_name="",
                limit=min(spec.limit for spec in bucket_specs),
                remaining=min(remaining_values),
                retry_after=max(retry_values),
            )

    async def refund(
        self,
        client_key: str,
        bucket_specs: tuple[_BucketSpec, ...],
    ) -> None:
        """Return the most recent reservation for a successfully verified client."""
        async with self._lock:
            for spec in bucket_specs:
                key = (client_key, spec.name)
                timestamps = self._events.get(key)
                if not timestamps:
                    continue
                timestamps.pop()
                if not timestamps:
                    del self._events[key]

    @staticmethod
    def _prune(timestamps: deque[float], now: float, window_seconds: int) -> None:
        cutoff = now - window_seconds
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()

    @staticmethod
    def _retry_after(timestamps: deque[float], now: float, window_seconds: int) -> int:
        if not timestamps:
            return window_seconds
        return max(1, ceil(window_seconds - (now - timestamps[0])))

    def _prune_stale_buckets(self, now: float) -> None:
        for key, timestamps in list(self._events.items()):
            _client_key, bucket_name = key
            window_seconds = self._bucket_windows.get(bucket_name, 3600)
            self._prune(timestamps, now, window_seconds)
            if not timestamps:
                del self._events[key]

        overflow_count = len(self._events) - _max_tracked_rate_limit_buckets()
        if overflow_count <= 0:
            return

        oldest_keys = sorted(
            self._events,
            key=lambda key: self._events[key][0] if self._events[key] else now,
        )
        for key in oldest_keys[:overflow_count]:
            del self._events[key]


def _max_tracked_rate_limit_buckets() -> int:
    module = sys.modules.get("atlas.platform.http.anonymous_rate_limit")
    if module is not None:
        return getattr(module, "_MAX_TRACKED_RATE_LIMIT_BUCKETS", _MAX_TRACKED_RATE_LIMIT_BUCKETS)
    return _MAX_TRACKED_RATE_LIMIT_BUCKETS


def _client_key_hash(client_key: str) -> str:
    return hashlib.sha256(client_key.encode("utf-8")).hexdigest()[:16]


def _path_group(path: str) -> str:
    if path.startswith("/api/"):
        return "/api/*"
    if path.startswith("/mcp"):
        return "/mcp/*"
    return path


def _forwarded_client_ip(header_value: str | None, *, trusted_proxy_hops: int) -> str | None:
    """Return the client address immediately before the trusted proxy chain."""
    if not header_value:
        return None
    candidates = [_normalized_ip(part) for part in header_value.split(",")]
    addresses = [candidate for candidate in candidates if candidate is not None]
    if not addresses:
        return None
    if trusted_proxy_hops <= 0:
        return addresses[-1]
    index = max(0, len(addresses) - trusted_proxy_hops - 1)
    return addresses[index]


def _normalized_ip(value: str | None) -> str | None:
    """Return a normalized IP string, or None for untrusted malformed values."""
    if value is None:
        return None
    candidate = value.strip().strip('"')
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    elif ":" in candidate and candidate.count(":") == 1:
        candidate = candidate.rsplit(":", 1)[0]
    try:
        return str(ip_address(candidate))
    except ValueError:
        return None
