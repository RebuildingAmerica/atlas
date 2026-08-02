"""Anonymous request admission control for public Atlas surfaces."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from http import HTTPStatus
from math import ceil
from secrets import compare_digest
from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from atlas.domains.access.api_keys import verify_api_key
from atlas.domains.access.jwt import verify_bearer_jwt
from atlas.domains.access.request_state import API_KEY_PRINCIPAL_STATE_KEY
from atlas.platform.http.anonymous_rate_limit_support import (
    _ACTOR_EMAIL_HEADER,
    _ACTOR_ID_HEADER,
    _API_KEY_CACHE_TTL_SECONDS,
    _CLIENT_IP_HEADER,
    _EXEMPT_PATHS,
    _INTERNAL_SECRET_HEADER,
    _LIMITED_EXACT_PATHS,
    _LIMITED_PATH_PREFIXES,
    _MAX_API_KEY_CACHE_ENTRIES,
    _PROXY_SECRET_HEADER,
    _ApiKeyCacheEntry,
    _BucketSpec,
    _client_key_hash,
    _forwarded_client_ip,
    _InvalidBearerCacheEntry,
    _normalized_ip,
    _path_group,
    _RateLimitResult,
    _SlidingWindowLimiter,
)
from atlas.platform.http.anonymous_rate_limit_support import (
    _MAX_TRACKED_RATE_LIMIT_BUCKETS as _SUPPORT_MAX_TRACKED_RATE_LIMIT_BUCKETS,
)

_MAX_TRACKED_RATE_LIMIT_BUCKETS = _SUPPORT_MAX_TRACKED_RATE_LIMIT_BUCKETS
_CREDENTIAL_VERIFICATION_LOCK_STRIPES = 256

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp

    from atlas.platform.config import Settings

    Dispatch = Callable[[Request], Awaitable[Response]]

__all__ = ["AnonymousRateLimitMiddleware"]

logger = logging.getLogger(__name__)


class AnonymousRateLimitMiddleware(BaseHTTPMiddleware):
    """Reject abusive unauthenticated traffic before expensive handlers run."""

    def __init__(self, app: ASGIApp, *, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings
        self._limiter = _SlidingWindowLimiter()
        self._api_key_cache: dict[str, _ApiKeyCacheEntry] = {}
        self._bearer_cache: dict[str, _InvalidBearerCacheEntry] = {}
        self._credential_verification_locks = tuple(
            asyncio.Lock() for _ in range(_CREDENTIAL_VERIFICATION_LOCK_STRIPES)
        )

    async def dispatch(self, request: Request, call_next: Dispatch) -> Response:
        """Apply anonymous rate limits or pass the request through."""
        if not self._should_limit(request):
            return await call_next(request)

        if self._has_trusted_internal_actor(request):
            return await call_next(request)

        client_key = self._client_key(request)
        has_credential_headers = self._has_credential_headers(request)
        if has_credential_headers:
            credential_specs = self._credential_bucket_specs()
            authenticated = False
            async with self._credential_verification_lock(client_key):
                result = await self._limiter.reserve(client_key, credential_specs)
                if not result.allowed:
                    return self._rate_limited_response(request, client_key, result)
                if await self._is_authenticated_request(request):
                    await self._limiter.refund(client_key, credential_specs)
                    authenticated = True
                else:
                    self._log_invalid_credential_attempt(request, client_key)
            if authenticated:
                return await call_next(request)

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
        return self._has_valid_bearer(request)

    def _has_credential_headers(self, request: Request) -> bool:
        return bool(request.headers.get("authorization") or request.headers.get("x-api-key"))

    def _credential_verification_lock(self, client_key: str) -> asyncio.Lock:
        digest = hashlib.sha256(client_key.encode("utf-8")).digest()
        index = int.from_bytes(digest[:2], byteorder="big") % len(
            self._credential_verification_locks
        )
        return self._credential_verification_locks[index]

    def _has_valid_bearer(self, request: Request) -> bool:
        authorization = request.headers.get("authorization")
        if not authorization:
            return False

        cache_key = hashlib.sha256(authorization.encode("utf-8")).hexdigest()
        cached = self._bearer_cache.get(cache_key)
        now = time.monotonic()
        if cached is not None and cached.expires_at > now:
            return False
        if cached is not None:
            del self._bearer_cache[cache_key]

        payload = verify_bearer_jwt(
            authorization,
            issuer=self._settings.auth_jwt_issuer,
            audience=self._settings.auth_jwt_audience,
            jwks_url=self._settings.auth_jwt_jwks_url,
        )
        if payload is not None:
            return True

        self._prune_bearer_cache(now)
        self._bearer_cache[cache_key] = _InvalidBearerCacheEntry(
            expires_at=now + _API_KEY_CACHE_TTL_SECONDS,
        )
        return False

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

    def _prune_bearer_cache(self, now: float) -> None:
        for cache_key, entry in list(self._bearer_cache.items()):
            if entry.expires_at <= now:
                del self._bearer_cache[cache_key]

        overflow_count = len(self._bearer_cache) - _MAX_API_KEY_CACHE_ENTRIES + 1
        if overflow_count <= 0:
            return

        oldest_keys = sorted(
            self._bearer_cache,
            key=lambda cache_key: self._bearer_cache[cache_key].expires_at,
        )
        for cache_key in oldest_keys[:overflow_count]:
            del self._bearer_cache[cache_key]

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
