import os
import textwrap
from pathlib import Path
from types import SimpleNamespace

import pytest

from atlas_scout.config import (
    APP_DIR_NAME,
    ScoutConfig,
    _standard_config_dir,
    _standard_data_dir,
    load_config,
)


def test_load_config_defaults():
    config = ScoutConfig()
    assert config.llm.provider == "ollama"
    assert config.llm.model == "llama3.1:8b"
    assert config.llm.max_concurrent == 10
    assert config.scraper.max_concurrent_fetches == 20
    assert config.scraper.page_cache_ttl_days == 7
    assert config.pipeline.min_entry_score == 0.3


def test_load_config_from_toml(tmp_path: Path):
    config_file = tmp_path / "scout.toml"
    config_file.write_text(textwrap.dedent("""\
        [llm]
        provider = "anthropic"
        model = "claude-sonnet-4-20250514"
        max_concurrent = 5

        [scraper]
        max_concurrent_fetches = 10
    """))
    config = load_config(config_file)
    assert config.llm.provider == "anthropic"
    assert config.llm.model == "claude-sonnet-4-20250514"
    assert config.llm.max_concurrent == 5
    assert config.scraper.max_concurrent_fetches == 10
    assert config.scraper.page_cache_ttl_days == 7


def test_load_config_with_targets(tmp_path: Path):
    config_file = tmp_path / "scout.toml"
    config_file.write_text(textwrap.dedent("""\
        [llm]
        provider = "ollama"

        [[schedule.targets]]
        location = "Austin, TX"
        issues = ["housing_affordability", "education_funding_and_policy"]
        search_depth = "standard"

        [[schedule.targets]]
        location = "Houston, TX"
        issues = ["healthcare_access_and_coverage"]
        search_depth = "deep"
    """))
    config = load_config(config_file)
    assert len(config.schedule.targets) == 2
    assert config.schedule.targets[0].location == "Austin, TX"
    assert config.schedule.targets[1].search_depth == "deep"


def test_load_config_missing_file_returns_defaults(tmp_path: Path):
    config = load_config(tmp_path / "nonexistent.toml")
    assert config.llm.provider == "ollama"


# ---------------------------------------------------------------------------
# Per-OS standard directories
# ---------------------------------------------------------------------------


def test_standard_config_dir_on_windows_uses_appdata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.os", fake_os)
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))

    result = _standard_config_dir()

    assert result == tmp_path / "Roaming" / APP_DIR_NAME


def test_standard_config_dir_on_windows_without_appdata_falls_back_to_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("APPDATA", raising=False)
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.os", fake_os)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_config_dir()

    assert result == tmp_path / "AppData" / "Roaming" / APP_DIR_NAME


def test_standard_config_dir_on_linux_uses_xdg(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.os.name", "posix")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))

    result = _standard_config_dir()

    assert result == tmp_path / "xdg" / APP_DIR_NAME


def test_standard_config_dir_on_linux_without_xdg_falls_back_to_dot_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.os.name", "posix")
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_config_dir()

    assert result == tmp_path / ".config" / APP_DIR_NAME


def test_standard_data_dir_on_darwin_uses_application_support(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.sys.platform", "darwin")
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_data_dir()

    assert result == tmp_path / "Library" / "Application Support" / APP_DIR_NAME


def test_standard_data_dir_on_windows_uses_local_appdata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.os", fake_os)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))

    result = _standard_data_dir()

    assert result == tmp_path / "Local" / APP_DIR_NAME


def test_standard_data_dir_on_windows_falls_back_to_appdata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.os", fake_os)
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))

    result = _standard_data_dir()

    assert result == tmp_path / "Roaming" / APP_DIR_NAME


def test_standard_data_dir_on_windows_no_env_falls_back_to_home_local(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.os", fake_os)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_data_dir()

    assert result == tmp_path / "AppData" / "Local" / APP_DIR_NAME


def test_standard_data_dir_on_linux_uses_xdg_data(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.os.name", "posix")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg-data"))

    result = _standard_data_dir()

    assert result == tmp_path / "xdg-data" / APP_DIR_NAME


def test_standard_data_dir_on_linux_falls_back_to_local_share(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.os.name", "posix")
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_data_dir()

    assert result == tmp_path / ".local" / "share" / APP_DIR_NAME
