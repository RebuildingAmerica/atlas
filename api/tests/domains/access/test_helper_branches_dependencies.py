"""Tests for access helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.routing import Route

from atlas.domains.access import capabilities as access_capabilities
from atlas.domains.access import dependencies as access_dependencies
from atlas.domains.access.principals import AuthenticatedActor
from atlas.config import Settings


class TestDependencies:
    """Request-usage accounting helpers."""

    @pytest.mark.asyncio
    async def test_route_usage_resource_id_and_duplicate_guard(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Route templates should be preferred, then the raw URL path, then the repeat guard."""
        record_mock = AsyncMock()
        monkeypatch.setattr(access_dependencies.OrgUsageEventCRUD, "record", record_mock)

        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="api_key",
            org_id="org-1",
        )

        routed_request = SimpleNamespace(
            method="GET",
            scope={"route": Route("/api/entities/{entity_id}", lambda request: None)},
            url=SimpleNamespace(path="/api/entities/entry-1"),
            state=SimpleNamespace(),
        )
        await access_dependencies._record_external_api_call_usage(
            AsyncMock(),
            request=routed_request,
            actor=actor,
        )

        fallback_request = SimpleNamespace(
            method="GET",
            scope={"route": object()},
            url=SimpleNamespace(path="/api/fallback"),
            state=SimpleNamespace(),
        )
        await access_dependencies._record_external_api_call_usage(
            AsyncMock(),
            request=fallback_request,
            actor=actor,
        )

        repeated_request = SimpleNamespace(
            method="GET",
            scope={"route": object()},
            url=SimpleNamespace(path="/api/repeated"),
            state=SimpleNamespace(_atlas_api_usage_recorded=True),
        )
        await access_dependencies._record_external_api_call_usage(
            AsyncMock(),
            request=repeated_request,
            actor=actor,
        )

        assert record_mock.await_count == 2
        assert record_mock.await_args_list[0].args[1].resource_id == "/api/entities/{entity_id}"
        assert record_mock.await_args_list[1].args[1].resource_id == "/api/fallback"

    def test_route_usage_resource_id_falls_back_to_url_path(self) -> None:
        """Non-route scopes should use the raw request path."""
        request = SimpleNamespace(scope={"route": object()}, url=SimpleNamespace(path="/api/raw"))

        assert access_dependencies._route_usage_resource_id(request) == "/api/raw"


class TestCapabilities:
    """Capability limit helpers."""

    @pytest.mark.asyncio
    async def test_enforce_limit_uses_public_actor_capabilities(self) -> None:
        """Public actors should pass through the inner capability helper unchanged."""
        dependency = access_capabilities.enforce_limit("max_api_keys")
        capability_actor = dependency.__defaults__[0].dependency
        public_actor = AuthenticatedActor(
            user_id="user-2",
            email="reader@example.com",
            auth_type="oauth_jwt",
        )
        settings = Settings(database_url="sqlite:///tmp/test.db")

        returned_actor = await capability_actor(actor=public_actor, settings=settings)
        limit = await dependency(actor=public_actor)

        assert returned_actor is public_actor
        assert limit == 0
