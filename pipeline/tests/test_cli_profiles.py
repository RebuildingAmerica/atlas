"""Tests for CLI config profile commands (profiles, use-profile, --profile flag)."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import patch

from click.testing import CliRunner

from atlas_scout.cli import main

if TYPE_CHECKING:
    from pathlib import Path


def _setup_profiles(tmp_path: Path, names: list[str]) -> Path:
    """Create a fake configs dir with empty profile files and return it."""
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    for name in names:
        (configs_dir / f"{name}.toml").write_text('[llm]\nprovider = "ollama"\n')
    return configs_dir


def _patches(tmp_path: Path, configs_dir: Path):
    """Return a stack of patches for isolating config/settings to tmp_path."""
    return (
        patch("atlas_scout.config.SCOUT_CONFIGS_DIR", configs_dir),
        patch("atlas_scout.config.SETTINGS_PATH", tmp_path / "settings.toml"),
        patch("atlas_scout.config.SCOUT_CONFIG_DIR", tmp_path),
        patch("atlas_scout.config.SCOUT_DATA_DIR", tmp_path / "data"),
        patch("atlas_scout.cli.SCOUT_CONFIGS_DIR", configs_dir),
    )


# ---------------------------------------------------------------------------
# config profiles
# ---------------------------------------------------------------------------


def test_config_profiles_lists_all(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default", "laptop", "studio"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["config", "profiles"])
    assert result.exit_code == 0
    assert "default" in result.output
    assert "laptop" in result.output
    assert "studio" in result.output


def test_config_profiles_marks_active(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default", "studio"])
    settings_path = tmp_path / "settings.toml"
    settings_path.write_text('active_profile = "studio"\n')
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["config", "profiles"])
    assert result.exit_code == 0
    assert "studio" in result.output
    # The active marker should appear (Rich markup stripped by CliRunner)
    assert "active" in result.output


def test_config_profiles_empty_dir(tmp_path: Path):
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["config", "profiles"])
    assert result.exit_code == 0
    assert "No profiles found" in result.output


# ---------------------------------------------------------------------------
# config use-profile
# ---------------------------------------------------------------------------


def test_use_profile_sets_active(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default", "studio"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["config", "use-profile", "studio"])
    assert result.exit_code == 0
    assert "studio" in result.output
    # Verify the settings file was written
    settings = (tmp_path / "settings.toml").read_text()
    assert 'active_profile = "studio"' in settings


def test_use_profile_nonexistent_fails(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default", "laptop"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["config", "use-profile", "nonexistent"])
    assert result.exit_code != 0


def test_use_profile_nonexistent_shows_available(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default", "laptop"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["config", "use-profile", "nonexistent"])
    assert "default" in result.output
    assert "laptop" in result.output


# ---------------------------------------------------------------------------
# --profile flag on root group
# ---------------------------------------------------------------------------


def test_profile_flag_loads_correct_config(tmp_path: Path):
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    studio = configs_dir / "studio.toml"
    studio.write_text('[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n')
    (configs_dir / "default.toml").write_text('[llm]\nprovider = "ollama"\n')
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["--profile", "studio", "config", "show"])
    assert result.exit_code == 0
    assert "anthropic" in result.output


def test_profile_flag_nonexistent_errors(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["--profile", "bogus", "config", "show"])
    assert result.exit_code != 0
    assert "bogus" in result.output


def test_profile_flag_nonexistent_lists_available(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["default", "laptop"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["--profile", "bogus", "config", "show"])
    assert "Available profiles" in result.output


# ---------------------------------------------------------------------------
# --config flag overrides --profile
# ---------------------------------------------------------------------------


def test_config_flag_overrides_profile(tmp_path: Path):
    custom = tmp_path / "custom.toml"
    custom.write_text('[llm]\nprovider = "anthropic"\nmodel = "custom-model"\n')
    configs_dir = _setup_profiles(tmp_path, ["default"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(
            main, ["--config", str(custom), "config", "show"]
        )
    assert result.exit_code == 0
    assert "custom-model" in result.output


# ---------------------------------------------------------------------------
# config show reflects loaded profile name
# ---------------------------------------------------------------------------


def test_config_show_displays_profile_name(tmp_path: Path):
    configs_dir = _setup_profiles(tmp_path, ["studio"])
    patches = _patches(tmp_path, configs_dir)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        result = CliRunner().invoke(main, ["--profile", "studio", "config", "show"])
    assert result.exit_code == 0
    assert "studio" in result.output
