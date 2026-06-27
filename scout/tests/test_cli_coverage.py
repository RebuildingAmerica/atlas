"""Comprehensive coverage tests for atlas_scout.cli.

These tests cover code paths not exercised by ``test_cli.py`` or
``test_cli_profiles.py``: the ``run`` extra branches (provider/model/file
sources, quiet, follow-link overrides), the ``db``/``runs``/``entries``/
``pages``/``schedule``/``daemon`` commands' full behaviour, and assorted
helper functions.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any
from unittest.mock import patch

from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    _build_provider,
    _resolved_profile_name,
    _runtime_profile_for_run,
    main,
)
from atlas_scout.config import (
    LLMConfig,
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
    StoreConfig,
)

if TYPE_CHECKING:
    import pytest

DEFAULT_CRON = "0 2 * * *"


def _capture_consoles(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
    """Redirect both module consoles into a single buffer for assertions."""
    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def _make_config(tmp_path: Path, **overrides: Any) -> ScoutConfig:
    """Return a ScoutConfig pinned to a tmp DB."""
    base: dict[str, Any] = {"store": StoreConfig(path=str(tmp_path / "scout.db"))}
    base.update(overrides)
    return ScoutConfig(**base)


def _scheduled_config(tmp_path: Path) -> ScoutConfig:
    """ScoutConfig with one schedule target and tmp DB."""
    return _make_config(
        tmp_path,
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing"])]
        ),
    )


# ---------------------------------------------------------------------------
# init / root group
# ---------------------------------------------------------------------------


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


def test_runtime_profile_for_run_falls_back_when_no_kw(monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel = SimpleNamespace(search_concurrency=1, fetch_concurrency=1, extract_concurrency=1)

    def fake_build(_config: Any, **_kwargs: Any) -> Any:
        if _kwargs:
            raise TypeError("legacy signature")
        return sentinel

    monkeypatch.setattr(cli_module, "build_runtime_profile", fake_build)
    assert _runtime_profile_for_run(_make_config(Path("/tmp")), direct_mode=True) is sentinel


def test_main_debug_flag_configures_logging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """--debug should set the root logger to DEBUG."""
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    # Reset handlers so basicConfig actually applies during invocation.
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


# ---------------------------------------------------------------------------
# run command — extra branches
# ---------------------------------------------------------------------------


def test_run_overrides_provider_and_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """--provider and --model should mutate the loaded config before running."""
    captured: dict[str, Any] = {}

    async def fake_pipeline(*, config: ScoutConfig, **kwargs: Any) -> Any:
        captured["provider"] = config.llm.provider
        captured["model"] = config.llm.model
        captured["search_api_key"] = kwargs.get("search_api_key")
        captured["direct_urls"] = kwargs.get("direct_urls")
        return None

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)

    result = CliRunner().invoke(
        main,
        [
            "run",
            "--provider",
            "anthropic",
            "--model",
            "claude-sonnet",
            "--quiet",
            "https://example.com",
        ],
    )
    assert result.exit_code == 0
    assert captured["provider"] == "anthropic"
    assert captured["model"] == "claude-sonnet"
    assert captured["direct_urls"] == ["https://example.com"]


def test_run_reads_urls_and_prompt_from_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """URLs from --file (with comments) and prompt from --prompt-file should be merged."""
    url_file = tmp_path / "urls.txt"
    url_file.write_text("https://a.com\n# comment\n\nhttps://b.com\n")
    prompt_file = tmp_path / "prompt.txt"
    prompt_file.write_text("Find legal aid orgs   \n")

    captured: dict[str, Any] = {}

    async def fake_pipeline(*, config: ScoutConfig, **kwargs: Any) -> Any:  # noqa: ARG001
        captured.update(kwargs)
        return None

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)

    result = CliRunner().invoke(
        main,
        [
            "run",
            "-f",
            str(url_file),
            "--prompt-file",
            str(prompt_file),
            "--quiet",
            "--follow-links",
            "--max-link-depth",
            "5",
            "--max-pages-per-seed",
            "11",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured["direct_urls"] == ["https://a.com", "https://b.com"]
    assert captured["directive"] == "Find legal aid orgs"


def test_run_no_urls_no_search_key_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(main, ["run"], env={"SEARCH_API_KEY": ""})
    assert result.exit_code != 0
    assert "Usage:" in result.output


def test_run_search_mode_missing_location(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--issues",
            "housing",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0
    assert "--location required" in result.output


def test_run_search_mode_missing_issues(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--location",
            "Austin, TX",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0
    assert "--issues required" in result.output


# ---------------------------------------------------------------------------
# _build_provider
# ---------------------------------------------------------------------------


def test_build_provider_invokes_factory(monkeypatch: pytest.MonkeyPatch) -> None:
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


# ---------------------------------------------------------------------------
# db commands
# ---------------------------------------------------------------------------


def test_db_path_prints_db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["db", "path"])
    assert result.exit_code == 0
    assert config.store.path in output.getvalue()


def test_db_reset_cancelled_when_user_declines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    Path(config.store.path).write_text("existing")
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset"], input="n\n")
    assert result.exit_code == 0
    assert "Cancelled" in result.output
    assert Path(config.store.path).exists()


def test_db_reset_deletes_existing_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    Path(config.store.path).write_text("data")
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset", "--yes"])
    assert result.exit_code == 0
    assert "Deleted" in result.output
    assert "Database reset" in result.output
    assert not Path(config.store.path).exists()


def test_db_reset_yes_when_no_db_file_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset", "-y"])
    assert result.exit_code == 0
    assert "Database reset" in result.output


# ---------------------------------------------------------------------------
# config commands (set / get / show)
# ---------------------------------------------------------------------------


def test_config_set_invalid_key_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "set", "no_dot", "value"])
    assert result.exit_code != 0
    assert "section.field" in output.getvalue()


def test_config_set_writes_string_int_float_bool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target_config_path = tmp_path / "scout.toml"
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "get_active_config_path", lambda: target_config_path)

    runner = CliRunner()
    assert runner.invoke(main, ["config", "set", "llm.model", "gemma3n:latest"]).exit_code == 0
    assert runner.invoke(main, ["config", "set", "llm.max_concurrent", "12"]).exit_code == 0
    assert runner.invoke(main, ["config", "set", "llm.timeout_seconds", "1.5"]).exit_code == 0
    assert runner.invoke(main, ["config", "set", "scraper.follow_links", "true"]).exit_code == 0
    assert (
        runner.invoke(main, ["config", "set", "scraper.revisit_cached_urls", "false"]).exit_code
        == 0
    )

    text = target_config_path.read_text()
    assert 'model = "gemma3n:latest"' in text
    assert "max_concurrent = 12" in text
    assert "timeout_seconds = 1.5" in text
    assert "follow_links = true" in text
    assert "revisit_cached_urls = false" in text


def test_config_set_preserves_existing_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target_config_path = tmp_path / "scout.toml"
    target_config_path.write_text('[llm]\nprovider = "ollama"\n')
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "get_active_config_path", lambda: target_config_path)
    result = CliRunner().invoke(main, ["config", "set", "llm.model", "gemma"])
    assert result.exit_code == 0
    text = target_config_path.read_text()
    assert 'provider = "ollama"' in text
    assert 'model = "gemma"' in text


def test_config_get_returns_value(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path, llm=LLMConfig(provider="ollama", model="gemma"))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.model"])
    assert result.exit_code == 0
    assert "gemma" in result.output


def test_config_get_invalid_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "get", "no_dot"])
    assert result.exit_code != 0
    assert "section.field" in output.getvalue()


def test_config_get_unknown_section(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "get", "nope.thing"])
    assert result.exit_code != 0
    assert "Unknown section" in output.getvalue()


def test_config_get_redacts_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(
        tmp_path, llm=LLMConfig(provider="anthropic", model="claude", api_key="secret")
    )
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.api_key"])
    assert result.exit_code == 0
    assert "secret" not in result.output
    assert "***" in result.output


def test_config_get_returns_not_set_when_value_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path, llm=LLMConfig(provider="ollama", model="m", base_url=None))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.base_url"])
    assert result.exit_code == 0
    assert "not set" in result.output


def test_config_get_api_key_when_unset_shows_not_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.api_key"])
    assert result.exit_code == 0
    assert "not set" in result.output


# ---------------------------------------------------------------------------
# runs commands (list / inspect / sync)
# ---------------------------------------------------------------------------
