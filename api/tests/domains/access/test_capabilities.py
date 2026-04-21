"""Tests for the capability resolver."""

from __future__ import annotations

from atlas.domains.access.capabilities import (
    DEFAULT_CAPABILITIES,
    DEFAULT_LIMITS,
    get_limit,
    has_capability,
    resolve_capabilities,
)


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
