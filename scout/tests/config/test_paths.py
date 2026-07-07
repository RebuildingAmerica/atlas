"""Tests for OS-standard config/data directory resolution."""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING

from atlas_scout.config.paths import APP_DIR_NAME, _standard_config_dir, _standard_data_dir

if TYPE_CHECKING:
    import pytest


def test_standard_config_dir_on_windows_uses_appdata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.paths.os", fake_os)
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))

    result = _standard_config_dir()

    assert result == tmp_path / "Roaming" / APP_DIR_NAME


def test_standard_config_dir_on_windows_without_appdata_falls_back_to_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("APPDATA", raising=False)
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.paths.os", fake_os)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_config_dir()

    assert result == tmp_path / "AppData" / "Roaming" / APP_DIR_NAME


def test_standard_config_dir_on_linux_uses_xdg(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.paths.os.name", "posix")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))

    result = _standard_config_dir()

    assert result == tmp_path / "xdg" / APP_DIR_NAME


def test_standard_config_dir_on_linux_without_xdg_falls_back_to_dot_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.paths.os.name", "posix")
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_config_dir()

    assert result == tmp_path / ".config" / APP_DIR_NAME


def test_standard_config_dir_on_darwin_uses_application_support(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "darwin")
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_config_dir()

    assert result == tmp_path / "Library" / "Application Support" / APP_DIR_NAME


def test_standard_data_dir_on_darwin_uses_application_support(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "darwin")
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_data_dir()

    assert result == tmp_path / "Library" / "Application Support" / APP_DIR_NAME


def test_standard_data_dir_on_windows_uses_local_appdata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.paths.os", fake_os)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))

    result = _standard_data_dir()

    assert result == tmp_path / "Local" / APP_DIR_NAME


def test_standard_data_dir_on_windows_falls_back_to_appdata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.paths.os", fake_os)
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))

    result = _standard_data_dir()

    assert result == tmp_path / "Roaming" / APP_DIR_NAME


def test_standard_data_dir_on_windows_no_env_falls_back_to_home_local(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    fake_os = SimpleNamespace(name="nt", environ=os.environ, getenv=os.getenv)
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "win32")
    monkeypatch.setattr("atlas_scout.config.paths.os", fake_os)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_data_dir()

    assert result == tmp_path / "AppData" / "Local" / APP_DIR_NAME


def test_standard_data_dir_on_linux_uses_xdg_data(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.paths.os.name", "posix")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg-data"))

    result = _standard_data_dir()

    assert result == tmp_path / "xdg-data" / APP_DIR_NAME


def test_standard_data_dir_on_linux_falls_back_to_local_share(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("atlas_scout.config.paths.sys.platform", "linux")
    monkeypatch.setattr("atlas_scout.config.paths.os.name", "posix")
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    result = _standard_data_dir()

    assert result == tmp_path / ".local" / "share" / APP_DIR_NAME
