"""Tests for Settings and config profile management in atlas_scout.config."""

from __future__ import annotations

import textwrap
from typing import TYPE_CHECKING
from unittest.mock import patch

from atlas_scout.config import (
    DEFAULT_PROFILE_NAME,
    Settings,
    get_active_config_path,
    get_active_profile_name,
    load_settings,
    save_settings,
    set_active_profile_name,
)

if TYPE_CHECKING:
    from pathlib import Path


# ---------------------------------------------------------------------------
# Settings model
# ---------------------------------------------------------------------------


def test_settings_defaults():
    s = Settings()
    assert s.active_profile == DEFAULT_PROFILE_NAME


def test_settings_custom_profile():
    s = Settings(active_profile="studio")
    assert s.active_profile == "studio"


# ---------------------------------------------------------------------------
# load_settings / save_settings round-trip
# ---------------------------------------------------------------------------


def test_load_settings_missing_file(tmp_path: Path):
    """Returns defaults when settings.toml does not exist."""
    fake_path = tmp_path / "settings.toml"
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        s = load_settings()
    assert s.active_profile == DEFAULT_PROFILE_NAME


def test_save_and_load_settings_roundtrip(tmp_path: Path):
    fake_path = tmp_path / "settings.toml"
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        save_settings(Settings(active_profile="laptop"))
        loaded = load_settings()
    assert loaded.active_profile == "laptop"


def test_save_settings_creates_parent_dirs(tmp_path: Path):
    fake_path = tmp_path / "nested" / "dir" / "settings.toml"
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        save_settings(Settings(active_profile="studio"))
    assert fake_path.exists()


def test_load_settings_from_existing_toml(tmp_path: Path):
    fake_path = tmp_path / "settings.toml"
    fake_path.write_text(textwrap.dedent("""\
        active_profile = "studio"
    """))
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        s = load_settings()
    assert s.active_profile == "studio"


def test_load_settings_ignores_unknown_keys(tmp_path: Path):
    """Unknown keys in settings.toml should not cause errors."""
    fake_path = tmp_path / "settings.toml"
    fake_path.write_text(textwrap.dedent("""\
        active_profile = "laptop"
        some_future_setting = true
    """))
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        s = load_settings()
    assert s.active_profile == "laptop"


# ---------------------------------------------------------------------------
# get/set active profile helpers
# ---------------------------------------------------------------------------


def test_get_active_profile_name_default(tmp_path: Path):
    fake_path = tmp_path / "settings.toml"
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        assert get_active_profile_name() == DEFAULT_PROFILE_NAME


def test_set_and_get_active_profile_name(tmp_path: Path):
    fake_path = tmp_path / "settings.toml"
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        set_active_profile_name("studio")
        assert get_active_profile_name() == "studio"


def test_set_active_profile_preserves_file_format(tmp_path: Path):
    """The saved file should be valid TOML."""
    fake_path = tmp_path / "settings.toml"
    with patch("atlas_scout.config.SETTINGS_PATH", fake_path):
        set_active_profile_name("laptop")
    content = fake_path.read_text()
    assert 'active_profile = "laptop"' in content


# ---------------------------------------------------------------------------
# get_active_config_path
# ---------------------------------------------------------------------------


def test_get_active_config_path_default(tmp_path: Path):
    fake_settings = tmp_path / "settings.toml"
    fake_configs = tmp_path / "configs"
    with (
        patch("atlas_scout.config.SETTINGS_PATH", fake_settings),
        patch("atlas_scout.config.SCOUT_CONFIGS_DIR", fake_configs),
    ):
        result = get_active_config_path()
    assert result == fake_configs / "default.toml"


def test_get_active_config_path_after_set(tmp_path: Path):
    fake_settings = tmp_path / "settings.toml"
    fake_configs = tmp_path / "configs"
    with (
        patch("atlas_scout.config.SETTINGS_PATH", fake_settings),
        patch("atlas_scout.config.SCOUT_CONFIGS_DIR", fake_configs),
    ):
        set_active_profile_name("studio")
        result = get_active_config_path()
    assert result == fake_configs / "studio.toml"
