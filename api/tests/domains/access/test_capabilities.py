"""Tests for the capability resolver."""

from __future__ import annotations

from http import HTTPStatus
from typing import cast

import pytest
from fastapi import HTTPException

from atlas.domains.access.capabilities import (
    DEFAULT_CAPABILITIES,
    DEFAULT_LIMITS,
    get_limit,
    has_capability,
    require_capability,
    resolve_capabilities,
)
from atlas.domains.access.principals import AuthenticatedActor
from atlas.platform.config import Settings


class TestResolveCapabilities:
    def test_defaults_when_no_products(self) -> None:
        resolved = resolve_capabilities([])
        assert resolved.capabilities == DEFAULT_CAPABILITIES
        assert resolved.limits == DEFAULT_LIMITS

    def test_atlas_pro_capabilities(self) -> None:
        resolved = resolve_capabilities(["atlas_pro"])
        assert "research.unlimited" in resolved.capabilities
        assert "workspace.notes" in resolved.capabilities
        assert "workspace.export" in resolved.capabilities
        assert "api.keys" in resolved.capabilities
        assert "api.mcp" in resolved.capabilities
        assert "workspace.shared" not in resolved.capabilities
        assert "monitoring.watchlists" not in resolved.capabilities

    def test_atlas_team_capabilities(self) -> None:
        resolved = resolve_capabilities(["atlas_team"])
        assert "workspace.shared" in resolved.capabilities
        assert "monitoring.watchlists" in resolved.capabilities
        assert "integrations.slack" in resolved.capabilities
        assert "auth.sso" in resolved.capabilities

    def test_research_pass_same_as_pro(self) -> None:
        pro = resolve_capabilities(["atlas_pro"])
        rp = resolve_capabilities(["atlas_research_pass"])
        assert pro.capabilities == rp.capabilities

    def test_union_across_products(self) -> None:
        resolved = resolve_capabilities(["atlas_pro", "atlas_team"])
        assert "workspace.export" in resolved.capabilities
        assert "workspace.shared" in resolved.capabilities

    def test_most_permissive_limits(self) -> None:
        resolved = resolve_capabilities(["atlas_pro", "atlas_team"])
        assert resolved.limits["max_api_keys"] is None
        assert resolved.limits["max_members"] == 50  # noqa: PLR2004

    def test_pro_limits(self) -> None:
        resolved = resolve_capabilities(["atlas_pro"])
        assert resolved.limits["research_runs_per_month"] is None
        assert resolved.limits["max_api_keys"] == 1
        assert resolved.limits["api_requests_per_day"] == 1000  # noqa: PLR2004


class TestHasCapability:
    def test_granted(self) -> None:
        resolved = resolve_capabilities(["atlas_pro"])
        assert has_capability(resolved, "workspace.export") is True

    def test_missing(self) -> None:
        resolved = resolve_capabilities([])
        assert has_capability(resolved, "workspace.export") is False

    def test_default(self) -> None:
        resolved = resolve_capabilities([])
        assert has_capability(resolved, "research.run") is True


class TestGetLimit:
    def test_unlimited(self) -> None:
        resolved = resolve_capabilities(["atlas_pro"])
        assert get_limit(resolved, "research_runs_per_month") is None

    def test_constrained(self) -> None:
        resolved = resolve_capabilities([])
        assert get_limit(resolved, "research_runs_per_month") == 2  # noqa: PLR2004


def _build_actor(*, auth_type: str, products: list[str]) -> AuthenticatedActor:
    """Construct a minimal authenticated actor for require_capability tests."""
    actor = AuthenticatedActor(
        user_id="user_123",
        email="operator@atlas.example",
        auth_type=auth_type,
        org_id="org_123",
    )
    actor.active_products = products
    actor.resolved_capabilities = resolve_capabilities(products)
    return actor


def _build_settings() -> Settings:
    settings = Settings()
    settings.auth_jwt_audience = ["https://atlas.example/api"]
    return settings


class TestRequireCapabilityDependency:
    @pytest.mark.asyncio
    async def test_passes_when_capability_present(self) -> None:
        actor = _build_actor(auth_type="oauth_jwt", products=["atlas_pro"])
        dependency = require_capability("api.mcp")

        # The inner dependency closure exposes the same signature as the
        # FastAPI runtime; calling it directly bypasses the DI machinery.
        await dependency(actor=actor, settings=_build_settings())  # type: ignore[call-arg]

    @pytest.mark.asyncio
    async def test_oauth_jwt_missing_capability_emits_step_up_challenge(self) -> None:
        actor = _build_actor(auth_type="oauth_jwt", products=[])
        dependency = require_capability("api.mcp")

        with pytest.raises(HTTPException) as excinfo:
            await dependency(actor=actor, settings=_build_settings())  # type: ignore[call-arg]

        assert excinfo.value.status_code == HTTPStatus.FORBIDDEN
        challenge = (excinfo.value.headers or {}).get("WWW-Authenticate", "")
        assert challenge.startswith("Bearer "), (
            "OAuth-authenticated actors must receive a Bearer challenge per RFC 6750."
        )
        assert 'error="insufficient_scope"' in challenge
        assert 'scope="api.mcp"' in challenge
        assert 'error_uri="https://atlas.example/api/pricing"' in challenge, (
            "Spec §'Scope Challenge Handling' permits error_uri (RFC 6749 §5.2); "
            "Atlas points it at the pricing page so MCP clients can render an upgrade CTA."
        )

        detail = cast("dict[str, object]", excinfo.value.detail)
        assert detail["error"] == "plan_required"
        assert detail["plan_required"] == "pro"
        assert detail["upgrade_url"] == "https://atlas.example/api/pricing"

    @pytest.mark.asyncio
    async def test_api_key_missing_capability_omits_oauth_challenge(self) -> None:
        actor = _build_actor(auth_type="api_key", products=[])
        dependency = require_capability("api.mcp")

        with pytest.raises(HTTPException) as excinfo:
            await dependency(actor=actor, settings=_build_settings())  # type: ignore[call-arg]

        assert excinfo.value.status_code == HTTPStatus.FORBIDDEN
        # API-key principals don't run the OAuth step-up flow, so no Bearer
        # challenge is emitted; the structured body still tells the caller
        # which plan to upgrade to.
        assert excinfo.value.headers is None or "WWW-Authenticate" not in (
            excinfo.value.headers or {}
        )
        detail = cast("dict[str, object]", excinfo.value.detail)
        assert detail["error"] == "plan_required"
        assert detail["plan_required"] == "pro"
