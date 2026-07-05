"""Anonymous request admission control for public Atlas surfaces."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections import deque
from dataclasses import dataclass
from http import HTTPStatus
from ipaddress import ip_address
from math import ceil
from secrets import compare_digest
from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from atlas.domains.access.api_keys import verify_api_key
from atlas.domains.access.jwt import verify_bearer_jwt
from atlas.domains.access.request_state import API_KEY_PRINCIPAL_STATE_KEY

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp

    from atlas.domains.access.principals import ApiKeyPrincipal
    from atlas.platform.config import Settings

    Dispatch = Callable[[Request], Awaitable[Response]]

__all__ = ["AnonymousRateLimitMiddleware"]

logger = logging.getLogger(__name__)

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

        overflow_count = len(self._events) - _MAX_TRACKED_RATE_LIMIT_BUCKETS
        if overflow_count <= 0:
            return

        oldest_keys = sorted(
            self._events,
            key=lambda key: self._events[key][0] if self._events[key] else now,
        )
        for key in oldest_keys[:overflow_count]:
            del self._events[key]


class AnonymousRateLimitMiddleware(BaseHTTPMiddleware):
    """Reject abusive unauthenticated traffic before expensive handlers run."""

    def __init__(self, app: ASGIApp, *, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings
        self._limiter = _SlidingWindowLimiter()
        self._api_key_cache: dict[str, _ApiKeyCacheEntry] = {}

    async def dispatch(self, request: Request, call_next: Dispatch) -> Response:
        """Apply anonymous rate limits or pass the request through."""
        if not self._should_limit(request):
            return await call_next(request)

        if self._has_trusted_internal_actor(request):
            return await call_next(request)

        client_key = self._client_key(request)
        if self._has_credential_headers(request):
            result = await self._limiter.reserve(client_key, self._credential_bucket_specs())
            if not result.allowed:
                return self._rate_limited_response(request, client_key, result)

        has_credential_headers = self._has_credential_headers(request)
        if await self._is_authenticated_request(request):
            return await call_next(request)
        if has_credential_headers:
            self._log_invalid_credential_attempt(request, client_key)

        buckets = self._bucket_specs(request)
        result = await self._limiter.reserve(client_key, buckets)
        if result.allowed:
            return await call_next(request)

        return self._rate_limited_response(request, client_key, result)

    def _rate_limited_response(
        self,
        request: Request,
        client_key: str,
        result: _RateLimitResult,
    ) -> JSONResponse:
        self._log_blocked_request(request, client_key, result)
        reset_at = str(ceil(time.time() + result.retry_after))
        return JSONResponse(
            {"detail": "Too many requests."},
            status_code=HTTPStatus.TOO_MANY_REQUESTS,
            headers={
                "Cache-Control": "no-store",
                "Retry-After": str(result.retry_after),
                "X-RateLimit-Limit": str(result.limit),
                "X-RateLimit-Remaining": str(result.remaining),
                "X-RateLimit-Reset": reset_at,
            },
        )

    def _should_limit(self, request: Request) -> bool:
        if not self._settings.anonymous_rate_limit_enabled:
            return False
        if request.method == "OPTIONS":
            return False
        path = request.url.path
        if path in _EXEMPT_PATHS:
            return False
        return path in _LIMITED_EXACT_PATHS or path.startswith(_LIMITED_PATH_PREFIXES)

    def _bucket_specs(self, request: Request) -> tuple[_BucketSpec, ...]:
        if request.method in {"GET", "HEAD"}:
            minute_spec = _BucketSpec(
                name="read-minute",
                limit=self._settings.anonymous_rate_limit_reads_per_minute,
                window_seconds=60,
            )
        else:
            minute_spec = _BucketSpec(
                name="write-minute",
                limit=self._settings.anonymous_rate_limit_writes_per_minute,
                window_seconds=60,
            )
        return (
            minute_spec,
            _BucketSpec(
                name="total-hour",
                limit=self._settings.anonymous_rate_limit_total_per_hour,
                window_seconds=3600,
            ),
        )

    def _credential_bucket_specs(self) -> tuple[_BucketSpec, ...]:
        return (
            _BucketSpec(
                name="credential-minute",
                limit=self._settings.anonymous_credential_rate_limit_per_minute,
                window_seconds=60,
            ),
            _BucketSpec(
                name="credential-hour",
                limit=self._settings.anonymous_credential_rate_limit_total_per_hour,
                window_seconds=3600,
            ),
        )

    async def _is_authenticated_request(self, request: Request) -> bool:
        if self._has_trusted_internal_actor(request):
            return True
        if await self._has_valid_api_key(request):
            return True
        return (
            verify_bearer_jwt(
                request.headers.get("authorization"),
                issuer=self._settings.auth_jwt_issuer,
                audience=self._settings.auth_jwt_audience,
                jwks_url=self._settings.auth_jwt_jwks_url,
            )
            is not None
        )

    def _has_credential_headers(self, request: Request) -> bool:
        return bool(request.headers.get("authorization") or request.headers.get("x-api-key"))

    def _credential_kind(self, request: Request) -> str:
        has_api_key = bool(request.headers.get("x-api-key"))
        authorization = request.headers.get("authorization", "")
        has_authorization = bool(authorization)
        if has_api_key and has_authorization:
            return "multiple"
        if has_api_key:
            return "api_key"
        if authorization.lower().startswith("bearer "):
            return "bearer"
        if has_authorization:
            return "authorization"
        return "none"

    async def _has_valid_api_key(self, request: Request) -> bool:
        api_key = request.headers.get("x-api-key")
        if not api_key:
            return False

        cache_key = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        cached = self._api_key_cache.get(cache_key)
        now = time.monotonic()
        if cached is not None and cached.expires_at > now:
            if cached.principal is not None:
                setattr(request.state, API_KEY_PRINCIPAL_STATE_KEY, cached.principal)
                return True
            return False
        if cached is not None:
            del self._api_key_cache[cache_key]

        try:
            principal = await verify_api_key(api_key, self._settings)
        except Exception:
            logger.exception(
                "API key verification failed before anonymous rate limiting",
                extra={"event": "api_key_rate_limit_bypass_check_failed"},
            )
            return False

        self._prune_api_key_cache(now)
        self._api_key_cache[cache_key] = _ApiKeyCacheEntry(
            principal=principal,
            expires_at=now + _API_KEY_CACHE_TTL_SECONDS,
        )
        if principal is None:
            return False
        setattr(request.state, API_KEY_PRINCIPAL_STATE_KEY, principal)
        return True

    def _prune_api_key_cache(self, now: float) -> None:
        for cache_key, entry in list(self._api_key_cache.items()):
            if entry.expires_at <= now:
                del self._api_key_cache[cache_key]

        overflow_count = len(self._api_key_cache) - _MAX_API_KEY_CACHE_ENTRIES + 1
        if overflow_count <= 0:
            return

        oldest_keys = sorted(
            self._api_key_cache,
            key=lambda cache_key: self._api_key_cache[cache_key].expires_at,
        )
        for cache_key in oldest_keys[:overflow_count]:
            del self._api_key_cache[cache_key]

    def _has_trusted_internal_actor(self, request: Request) -> bool:
        configured_secret = self._settings.auth_internal_secret
        supplied_secret = request.headers.get(_INTERNAL_SECRET_HEADER)
        if not configured_secret or not supplied_secret:
            return False
        if not compare_digest(supplied_secret, configured_secret):
            return False
        return bool(
            request.headers.get(_ACTOR_ID_HEADER) and request.headers.get(_ACTOR_EMAIL_HEADER)
        )

    def _client_key(self, request: Request) -> str:
        signed_client_ip = self._signed_proxy_client_ip(request)
        if signed_client_ip:
            return f"proxy:{signed_client_ip}"

        if self._settings.trust_unsigned_forward_headers:
            forwarded_client_ip = _forwarded_client_ip(
                request.headers.get("x-forwarded-for"),
                trusted_proxy_hops=self._settings.trusted_proxy_hops,
            )
            if forwarded_client_ip:
                return f"forwarded:{forwarded_client_ip}"

        direct_host = request.client.host if request.client else "unknown"
        return f"direct:{direct_host}"

    def _log_blocked_request(
        self,
        request: Request,
        client_key: str,
        result: _RateLimitResult,
    ) -> None:
        logger.warning(
            "Anonymous request rate limited",
            extra={
                "event": "anonymous_rate_limited",
                "layer": "api",
                "bucket": result.bucket_name,
                "method": request.method,
                "path_group": _path_group(request.url.path),
                "retry_after_seconds": result.retry_after,
                "client_key_hash": _client_key_hash(client_key),
            },
        )

    def _log_invalid_credential_attempt(self, request: Request, client_key: str) -> None:
        logger.warning(
            "Invalid credential attempt",
            extra={
                "event": "invalid_credential_attempt",
                "layer": "api",
                "credential_kind": self._credential_kind(request),
                "method": request.method,
                "path_group": _path_group(request.url.path),
                "client_key_hash": _client_key_hash(client_key),
            },
        )

    def _signed_proxy_client_ip(self, request: Request) -> str | None:
        supplied_secret = request.headers.get(_PROXY_SECRET_HEADER)
        if not supplied_secret:
            return None
        for configured_secret in (
            self._settings.auth_internal_secret,
            self._settings.edge_origin_secret,
        ):
            if configured_secret and compare_digest(supplied_secret, configured_secret):
                return _normalized_ip(request.headers.get(_CLIENT_IP_HEADER))
        return None


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
