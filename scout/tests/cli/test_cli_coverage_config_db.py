"""Comprehensive coverage tests for atlas_scout.cli."""

from __future__ import annotations

from pathlib import Path

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.config import LLMConfig
from atlas_scout.cli import main

from .test_cli_coverage_support import _capture_consoles, _make_config


def test_db_path_prints_db_path(tmp_path: Path, monkeypatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["db", "path"])
    assert result.exit_code == 0
    assert config.store.path in output.getvalue()


def test_db_reset_cancelled_when_user_declines(
    tmp_path: Path, monkeypatch
) -> None:
    config = _make_config(tmp_path)
    Path(config.store.path).write_text("existing")
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset"], input="n\n")
    assert result.exit_code == 0
    assert "Cancelled" in result.output
    assert Path(config.store.path).exists()


def test_db_reset_deletes_existing_database(
    tmp_path: Path, monkeypatch
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
    tmp_path: Path, monkeypatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset", "-y"])
    assert result.exit_code == 0
    assert "Database reset" in result.output


def test_config_set_invalid_key_errors(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "set", "no_dot", "value"])
    assert result.exit_code != 0
    assert "section.field" in output.getvalue()


def test_config_set_writes_string_int_float_bool(
    tmp_path: Path, monkeypatch
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
    tmp_path: Path, monkeypatch
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


def test_config_get_returns_value(tmp_path: Path, monkeypatch) -> None:
    config = _make_config(tmp_path, llm=LLMConfig(provider="ollama", model="gemma"))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.model"])
    assert result.exit_code == 0
    assert "gemma" in result.output


def test_config_get_invalid_key(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "get", "no_dot"])
    assert result.exit_code != 0
    assert "section.field" in output.getvalue()


def test_config_get_unknown_section(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "get", "nope.thing"])
    assert result.exit_code != 0
    assert "Unknown config section" in output.getvalue()


def test_config_get_rejects_api_key(tmp_path: Path, monkeypatch) -> None:
    config = _make_config(
        tmp_path, llm=LLMConfig(provider="anthropic", model="claude", api_key="secret")
    )
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.api_key"])
    assert result.exit_code != 0
    assert "not saved in Scout profile config" in result.output
    assert "secret" not in result.output


def test_config_get_returns_not_set_when_value_none(
    tmp_path: Path, monkeypatch
) -> None:
    config = _make_config(tmp_path, llm=LLMConfig(provider="ollama", model="m", base_url=None))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.base_url"])
    assert result.exit_code == 0
    assert "not set" in result.output


def test_config_get_api_key_when_unset_shows_not_set(
    tmp_path: Path, monkeypatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.api_key"])
    assert result.exit_code != 0
    assert "not saved in Scout profile config" in result.output
