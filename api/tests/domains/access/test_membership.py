"""Tests for the membership verification client."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from atlas.domains.access.membership import (
    MembershipResult,
    verify_org_membership,
)
from atlas.platform.config import Settings


def _make_settings(
    url: str = "http://localhost:3000",
    secret: str = "test-secret",
    bypass_secret: str = "",
) -> MagicMock:
    settings = MagicMock(spec=Settings)
    settings.auth_membership_verification_url = url
    settings.auth_internal_secret = secret
    settings.auth_membership_protection_bypass_secret = bypass_secret
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


async def test_membership_change_is_visible_on_the_next_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A paid upgrade or role change must not wait for a cached permission to expire."""
    settings = _make_settings()
    success_payload = {
        "role": "admin",
        "slug": "test-org",
        "name": "Test Org",
        "workspaceType": "team",
        "activeProducts": [],
    }
    call_count = 0

    def counting_factory(*, timeout: float) -> _FakeAsyncClient:
        nonlocal call_count
        call_count += 1
        del timeout
        if call_count == 2:
            success_payload["activeProducts"] = ["atlas_team"]
            success_payload["role"] = "owner"
        response = httpx.Response(
            200,
            json=success_payload,
            request=httpx.Request(
                "GET",
                "http://localhost:3000/api/auth/internal/memberships/org_1/members/user_1",
            ),
        )
        return _FakeAsyncClient(response)

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        counting_factory,
    )

    result1 = await verify_org_membership("user_1", "org_1", settings)
    assert call_count == 1
    assert result1 is not None
    assert result1.role == "admin"
    assert result1.active_products == []

    result2 = await verify_org_membership("user_1", "org_1", settings)
    assert call_count == 2
    assert result2 is not None
    assert result2.role == "owner"
    assert result2.active_products == ["atlas_team"]


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


async def test_membership_request_includes_configured_edge_bypass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hosted membership checks should carry an edge-protection bypass when configured."""
    settings = _make_settings(bypass_secret="vercel-bypass")
    response = httpx.Response(
        200,
        json={
            "role": "member",
            "slug": "my-org",
            "name": "My Org",
            "workspaceType": "team",
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

    assert result is not None
    assert client_instance.last_headers == {
        "X-Atlas-Internal-Secret": "test-secret",
        "x-vercel-protection-bypass": "vercel-bypass",
    }


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


async def test_200_response_returns_workspace_domain_proof_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Membership responses should preserve verified workspace-domain proof fields."""
    settings = _make_settings()
    response = httpx.Response(
        200,
        json={
            "role": "owner",
            "slug": "acme-corp",
            "name": "Acme Corp",
            "workspaceType": "team",
            "activeProducts": ["atlas_team"],
            "workspaceDomain": "acme.org",
            "verifiedSsoDomains": ["acme.org", "staff.acme.org"],
        },
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
    assert result.workspace_domain == "acme.org"
    assert result.verified_sso_domains == ["acme.org", "staff.acme.org"]


async def test_network_failure_propagates_after_logging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A transport-level failure logs and re-raises."""
    settings = _make_settings()

    monkeypatch.setattr(
        "atlas.domains.access.membership.httpx.AsyncClient",
        _client_factory(RuntimeError("network down")),
    )

    with pytest.raises(RuntimeError, match="network down"):
        await verify_org_membership("user_n", "org_n", settings)


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
