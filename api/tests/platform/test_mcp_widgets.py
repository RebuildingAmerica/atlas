"""Tests for the MCP Apps widget extension: resource registration and asset resolution."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.platform.mcp import widgets
from atlas.platform.mcp.server import build_mcp
from atlas.platform.mcp.widgets import (
    CONNECTIONS_GRAPH_RESOURCE_URI,
    ENTITY_CARD_RESOURCE_URI,
    MCP_APP_RESOURCE_MIME_TYPE,
    SEARCH_RESULTS_RESOURCE_URI,
    WIDGET_RESOURCES,
    install_widget_extension,
    load_widget_html,
    resolve_widget_asset_dir,
)

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


class _FakeSettings:
    """Minimal stand-in for `Settings`, exposing only the field this module reads."""

    def __init__(self, mcp_widget_assets_dir: str | None = None) -> None:
        self.mcp_widget_assets_dir = mcp_widget_assets_dir


@pytest.fixture(autouse=True)
def _reset_widget_cache() -> Iterator[None]:
    """`_widget_html_cache` is process-global state; keep tests independent."""
    widgets._widget_html_cache.clear()  # noqa: SLF001
    yield
    widgets._widget_html_cache.clear()  # noqa: SLF001


class TestResolveWidgetAssetDir:
    def test_uses_explicit_override_when_valid(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A configured ATLAS_MCP_WIDGET_ASSETS_DIR wins when it has the built file."""
        override_dir = tmp_path / "override"
        override_dir.mkdir()
        (override_dir / "entity-card.html").write_text("<html>override</html>")

        monkeypatch.setattr(
            widgets, "get_settings", lambda: _FakeSettings(mcp_widget_assets_dir=str(override_dir))
        )
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", tmp_path / "unused-co-located")
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", tmp_path / "unused-monorepo")

        assert resolve_widget_asset_dir("entity-card") == override_dir

    def test_falls_through_when_override_missing_expected_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An override pointing at a directory without the built file isn't trusted blindly."""
        empty_override_dir = tmp_path / "empty-override"
        empty_override_dir.mkdir()
        co_located_dir = tmp_path / "co-located"
        co_located_dir.mkdir()
        (co_located_dir / "entity-card.html").write_text("<html>co-located</html>")

        monkeypatch.setattr(
            widgets,
            "get_settings",
            lambda: _FakeSettings(mcp_widget_assets_dir=str(empty_override_dir)),
        )
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", co_located_dir)
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", tmp_path / "unused-monorepo")

        assert resolve_widget_asset_dir("entity-card") == co_located_dir

    def test_uses_co_located_dir_when_no_override_configured(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With no override set, the co-located (production Docker) tier wins next."""
        co_located_dir = tmp_path / "co-located"
        co_located_dir.mkdir()
        (co_located_dir / "entity-card.html").write_text("<html>co-located</html>")

        monkeypatch.setattr(widgets, "get_settings", _FakeSettings)
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", co_located_dir)
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", tmp_path / "unused-monorepo")

        assert resolve_widget_asset_dir("entity-card") == co_located_dir

    def test_uses_monorepo_dev_dir_as_last_resort(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When neither override nor co-located tiers resolve, fall back to the dev build path."""
        monorepo_dir = tmp_path / "packages" / "entity-widgets" / "dist" / "widget"
        monorepo_dir.mkdir(parents=True)
        (monorepo_dir / "entity-card.html").write_text("<html>monorepo dev</html>")

        monkeypatch.setattr(widgets, "get_settings", _FakeSettings)
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", tmp_path / "missing-co-located")
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", monorepo_dir)

        assert resolve_widget_asset_dir("entity-card") == monorepo_dir

    def test_resolves_independently_per_widget_name(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A directory already holding one widget's file isn't trusted for another's.

        The co-located tier only has `entity-card.html`; resolving
        `search-results` must fall through past it to the monorepo tier
        rather than incorrectly returning the co-located dir just because
        *some* widget file exists there.
        """
        co_located_dir = tmp_path / "co-located"
        co_located_dir.mkdir()
        (co_located_dir / "entity-card.html").write_text("<html>entity card</html>")

        monorepo_dir = tmp_path / "packages" / "entity-widgets" / "dist" / "widget"
        monorepo_dir.mkdir(parents=True)
        (monorepo_dir / "search-results.html").write_text("<html>search results</html>")

        monkeypatch.setattr(widgets, "get_settings", _FakeSettings)
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", co_located_dir)
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", monorepo_dir)

        assert resolve_widget_asset_dir("entity-card") == co_located_dir
        assert resolve_widget_asset_dir("search-results") == monorepo_dir

    def test_raises_actionable_error_when_no_tier_resolves(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No silent fallback: a missing build artifact fails loudly and actionably."""
        monkeypatch.setattr(widgets, "get_settings", _FakeSettings)
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", tmp_path / "missing-co-located")
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", tmp_path / "missing-monorepo")

        with pytest.raises(RuntimeError, match="pnpm --filter @rebuildingamerica/entity-widgets"):
            resolve_widget_asset_dir("entity-card")

    def test_error_message_mentions_env_var_override(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The failure message should point at the override env var as an alternative."""
        monkeypatch.setattr(widgets, "get_settings", _FakeSettings)
        monkeypatch.setattr(widgets, "_CO_LOCATED_ASSET_DIR", tmp_path / "missing-co-located")
        monkeypatch.setattr(widgets, "_MONOREPO_DEV_ASSET_DIR", tmp_path / "missing-monorepo")

        with pytest.raises(RuntimeError, match="ATLAS_MCP_WIDGET_ASSETS_DIR"):
            resolve_widget_asset_dir("entity-card")


class TestLoadWidgetHtml:
    def test_reads_html_from_resolved_asset_dir(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        asset_dir = tmp_path / "assets"
        asset_dir.mkdir()
        (asset_dir / "entity-card.html").write_text("<html>entity card</html>")
        monkeypatch.setattr(widgets, "resolve_widget_asset_dir", lambda name: asset_dir)  # noqa: ARG005

        assert load_widget_html("entity-card") == "<html>entity card</html>"

    def test_caches_result_across_calls(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A second call must not re-resolve the asset dir or re-read the file."""
        asset_dir = tmp_path / "assets"
        asset_dir.mkdir()
        html_path = asset_dir / "entity-card.html"
        html_path.write_text("<html>first read</html>")

        calls = 0

        def _resolve(name: str) -> Path:  # noqa: ARG001
            nonlocal calls
            calls += 1
            return asset_dir

        monkeypatch.setattr(widgets, "resolve_widget_asset_dir", _resolve)

        first = load_widget_html("entity-card")
        html_path.write_text("<html>second read, should be ignored</html>")
        second = load_widget_html("entity-card")

        assert first == second == "<html>first read</html>"
        assert calls == 1

    def test_caches_independently_per_widget_name(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Loading one widget must not serve its HTML back for a different widget's name."""
        asset_dir = tmp_path / "assets"
        asset_dir.mkdir()
        (asset_dir / "entity-card.html").write_text("<html>entity card</html>")
        (asset_dir / "search-results.html").write_text("<html>search results</html>")
        monkeypatch.setattr(widgets, "resolve_widget_asset_dir", lambda name: asset_dir)  # noqa: ARG005

        assert load_widget_html("entity-card") == "<html>entity card</html>"
        assert load_widget_html("search-results") == "<html>search results</html>"


class TestInstallWidgetExtension:
    @pytest.mark.asyncio
    async def test_registers_expected_resource_uris_and_mime_types(self) -> None:
        mcp = build_mcp()

        resources = await mcp.list_resources()
        resources_by_uri = {str(r.uri): r for r in resources}

        assert set(WIDGET_RESOURCES.values()) <= set(resources_by_uri)
        for resource_uri in WIDGET_RESOURCES.values():
            assert resources_by_uri[resource_uri].mimeType == MCP_APP_RESOURCE_MIME_TYPE

    @pytest.mark.asyncio
    async def test_each_registered_resource_returns_its_own_widget_html(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        asset_dir = tmp_path / "assets"
        asset_dir.mkdir()
        (asset_dir / "entity-card.html").write_text("<html>entity card widget</html>")
        (asset_dir / "search-results.html").write_text("<html>search results widget</html>")
        (asset_dir / "connections-graph.html").write_text("<html>connections widget</html>")
        monkeypatch.setattr(widgets, "resolve_widget_asset_dir", lambda name: asset_dir)  # noqa: ARG005
        widgets._widget_html_cache.clear()  # noqa: SLF001

        mcp = build_mcp()

        entity_card_contents = list(await mcp.read_resource(ENTITY_CARD_RESOURCE_URI))
        search_results_contents = list(await mcp.read_resource(SEARCH_RESULTS_RESOURCE_URI))
        connections_graph_contents = list(await mcp.read_resource(CONNECTIONS_GRAPH_RESOURCE_URI))

        assert len(entity_card_contents) == 1
        assert entity_card_contents[0].content == "<html>entity card widget</html>"
        assert entity_card_contents[0].mime_type == MCP_APP_RESOURCE_MIME_TYPE

        assert len(search_results_contents) == 1
        assert search_results_contents[0].content == "<html>search results widget</html>"
        assert search_results_contents[0].mime_type == MCP_APP_RESOURCE_MIME_TYPE

        assert len(connections_graph_contents) == 1
        assert connections_graph_contents[0].content == "<html>connections widget</html>"
        assert connections_graph_contents[0].mime_type == MCP_APP_RESOURCE_MIME_TYPE

    @pytest.mark.asyncio
    async def test_install_widget_extension_is_idempotent_on_a_fresh_server(self) -> None:
        """Calling install_widget_extension directly (not just via build_mcp) still registers."""
        mcp = build_mcp()
        install_widget_extension(mcp)

        resources = await mcp.list_resources()

        for resource_uri in WIDGET_RESOURCES.values():
            matches = [r for r in resources if str(r.uri) == resource_uri]
            assert len(matches) == 1
