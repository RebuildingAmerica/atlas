"""Comprehensive coverage tests for atlas_scout.cli."""

from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import _build_provider, _resolved_profile_name, _runtime_profile_for_run, main
from atlas_scout.config import LLMConfig, ScoutConfig

from .test_cli_coverage_support import _make_config


def test_resolved_profile_name_returns_explicit() -> None:
    assert (
        _resolved_profile_name(
            explicit_config_path="/x/y.toml",
            requested_profile_name="studio",
            loaded_path=Path("/x/y.toml"),
        )
        == "studio"
    )


def test_resolved_profile_name_uses_active_when_no_explicit_path() -> None:
    with patch("atlas_scout.cli.get_active_profile_name", return_value="default"):
        assert (
            _resolved_profile_name(
                explicit_config_path=None,
                requested_profile_name=None,
                loaded_path=Path("/anything.toml"),
            )
            == "default"
        )


def test_resolved_profile_name_returns_stem_in_configs_dir(tmp_path: Path) -> None:
    fake_dir = tmp_path / "configs"
    fake_dir.mkdir()
    loaded = fake_dir / "studio.toml"
    loaded.write_text("")
    with patch.object(cli_module, "SCOUT_CONFIGS_DIR", fake_dir):
        assert (
            _resolved_profile_name(
                explicit_config_path=str(loaded),
                requested_profile_name=None,
                loaded_path=loaded,
            )
            == "studio"
        )


def test_resolved_profile_name_returns_none_for_outside_paths(tmp_path: Path) -> None:
    fake_dir = tmp_path / "configs"
    fake_dir.mkdir()
    other = tmp_path / "other.toml"
    other.write_text("")
    with patch.object(cli_module, "SCOUT_CONFIGS_DIR", fake_dir):
        assert (
            _resolved_profile_name(
                explicit_config_path=str(other),
                requested_profile_name=None,
                loaded_path=other,
            )
            is None
        )


def test_runtime_profile_for_run_falls_back_when_no_kw(monkeypatch) -> None:
    sentinel = SimpleNamespace(search_concurrency=1, fetch_concurrency=1, extract_concurrency=1)

    def fake_build(_config: Any, **_kwargs: Any) -> Any:
        if _kwargs:
            raise TypeError("legacy signature")
        return sentinel

    monkeypatch.setattr(cli_module, "build_runtime_profile", fake_build)
    assert _runtime_profile_for_run(_make_config(Path("/tmp")), direct_mode=True) is sentinel


def test_main_debug_flag_configures_logging(
    tmp_path: Path, monkeypatch
) -> None:
    """--debug should set the root logger to DEBUG."""
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    root = logging.getLogger()
    original_level = root.level
    original_handlers = root.handlers[:]
    root.handlers.clear()
    try:
        result = CliRunner().invoke(main, ["--debug", "config", "show"])
        assert result.exit_code == 0
        assert root.level == logging.DEBUG
    finally:
        root.handlers.clear()
        root.handlers.extend(original_handlers)
        root.setLevel(original_level)


def test_build_provider_invokes_factory(monkeypatch) -> None:
    sentinel = object()
    captured: dict[str, Any] = {}

    def fake_create(llm_config: Any, *, max_concurrent: int | None = None) -> Any:
        captured["llm"] = llm_config
        captured["max_concurrent"] = max_concurrent
        return sentinel

    import atlas_scout.providers as providers_module

    monkeypatch.setattr(providers_module, "create_provider", fake_create)
    config = ScoutConfig(llm=LLMConfig(provider="ollama", model="gemma"))
    assert _build_provider(config, max_concurrent=7) is sentinel
    assert captured["max_concurrent"] == 7
    assert captured["llm"] is config.llm
