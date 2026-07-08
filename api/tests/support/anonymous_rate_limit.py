"""Shared helpers for anonymous rate-limit tests."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import patch

import httpx

from atlas.main import create_app
from atlas.platform.config import Settings, get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

MINUTE_SECONDS = 60
EXPECTED_CACHE_ENTRIES_AFTER_PRE_INSERT_PRUNE = 9_999
READ_PATH = "/api/domains"
READ_PATH_GROUP = "/api/*"
OPENAPI_PATH = "/openapi.json"


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


__all__ = [
    "EXPECTED_CACHE_ENTRIES_AFTER_PRE_INSERT_PRUNE",
    "MINUTE_SECONDS",
    "OPENAPI_PATH",
    "READ_PATH",
    "READ_PATH_GROUP",
    "_client",
    "_settings",
]
