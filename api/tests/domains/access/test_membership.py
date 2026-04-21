"""Tests for the membership verification client."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from atlas.domains.access.membership import (
    MembershipResult,
    _cache,
    verify_org_membership,
)
from atlas.platform.config import Settings


def _make_settings(
    url: str = "http://localhost:3000",
    secret: str = "test-secret",
) -> MagicMock:
    settings = MagicMock(spec=Settings)
    settings.auth_membership_verification_url = url
    settings.auth_internal_secret = secret
    return settings


class _FakeAsyncClient:
    """Fake httpx.AsyncClient for testing membership verification."""

    def __init__(self, response: httpx.Response | Exception) -> None:
        self._response = response
        self.last_url: str | None = None
        self.last_headers: dict[str, str] | None = None

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
        self.last_url = url
        self.last_headers = headers
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _client_factory(response: httpx.Response | Exception) -> object:
    """Create a factory that returns a FakeAsyncClient with the given response."""
    client = _FakeAsyncClient(response)

    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return client

    return factory


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    """Clear the membership cache before each test."""
    _cache.clear()


async def test_cache_hit_returns_cached_result_without_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Second call within TTL should return cached result without making an HTTP request."""
    settings = _make_settings()
    success_payload = {
        "role": "admin",
        "slug": "test-org",
        "name": "Test Org",
        "workspaceType": "team",
        "activeProducts": [],
    }
    response = httpx.Response(
        200,
        json=success_payload,
        request=httpx.Request(
            "GET",
            "http://localhost:3000/api/auth/internal/memberships/org_1/members/user_1",
        ),
    )

    call_count = 0

    def counting_factory(*, timeout: float) -> _FakeAsyncClient:
        nonlocal call_count
        call_count += 1
        del timeout
        return _FakeAsyncClient(response)

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        counting_factory,
    )

    # First call: makes HTTP request
    result1 = await verify_org_membership("user_1", "org_1", settings)
    assert call_count == 1
    assert result1 is not None
    assert result1.role == "admin"

    # Second call: should use cache, no new HTTP request
    result2 = await verify_org_membership("user_1", "org_1", settings)
    assert call_count == 1
    assert result2 is not None
    assert result2.role == "admin"


async def test_cache_miss_makes_http_get(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cache miss should result in an HTTP GET request."""
    settings = _make_settings()
    response = httpx.Response(
        200,
        json={
            "role": "member",
            "slug": "my-org",
            "name": "My Org",
            "workspaceType": "personal",
            "activeProducts": [],
        },
        request=httpx.Request(
            "GET",
            "http://localhost:3000/api/auth/internal/memberships/org_2/members/user_2",
        ),
    )

    client_instance = _FakeAsyncClient(response)

    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return client_instance

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        factory,
    )

    result = await verify_org_membership("user_2", "org_2", settings)

    assert client_instance.last_url == (
        "http://localhost:3000/api/auth/internal/memberships/org_2/members/user_2"
    )
    assert client_instance.last_headers == {"X-Atlas-Internal-Secret": "test-secret"}
    assert result is not None


async def test_404_response_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 404 response should return None (user is not a member)."""
    settings = _make_settings()
    response = httpx.Response(
        404,
        request=httpx.Request(
            "GET",
            "http://localhost:3000/api/auth/internal/memberships/org_3/members/user_3",
        ),
    )

    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return _FakeAsyncClient(response)

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        factory,
    )

    result = await verify_org_membership("user_3", "org_3", settings)
    assert result is None


async def test_200_response_returns_membership_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 response should parse and return a MembershipResult with correct fields."""
    settings = _make_settings()
    payload = {
        "role": "owner",
        "slug": "acme-corp",
        "name": "Acme Corp",
        "workspaceType": "enterprise",
        "activeProducts": ["atlas_team"],
    }
    response = httpx.Response(
        200,
        json=payload,
        request=httpx.Request(
            "GET",
            "http://localhost:3000/api/auth/internal/memberships/org_4/members/user_4",
        ),
    )

    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return _FakeAsyncClient(response)

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        factory,
    )

    result = await verify_org_membership("user_4", "org_4", settings)

    assert result is not None
    assert isinstance(result, MembershipResult)
    assert result.role == "owner"
    assert result.slug == "acme-corp"
    assert result.name == "Acme Corp"
    assert result.workspace_type == "enterprise"
    assert result.active_products == ["atlas_team"]


async def test_non_200_non_404_raises_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-200/404 responses should raise an HTTPStatusError."""
    settings = _make_settings()
    response = httpx.Response(
        500,
        text="Internal Server Error",
        request=httpx.Request(
            "GET",
            "http://localhost:3000/api/auth/internal/memberships/org_5/members/user_5",
        ),
    )

    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return _FakeAsyncClient(response)

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        factory,
    )

    with pytest.raises(httpx.HTTPStatusError):
        await verify_org_membership("user_5", "org_5", settings)
