"""Scout profile command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main

if TYPE_CHECKING:
    from pathlib import Path


def test_config_create_profile_creates_and_activates_profile(
    tmp_path: Path,
    monkeypatch,
) -> None:
    configs_dir = tmp_path / "configs"
    activated: list[str] = []

    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", configs_dir)
    monkeypatch.setattr(cli_module, "set_active_profile_name", activated.append)

    result = CliRunner().invoke(
        main,
        ["--config", str(tmp_path / "current.toml"), "config", "create-profile", "studio"],
    )

    assert result.exit_code == 0, result.output
    assert (configs_dir / "studio.toml").exists()
    assert activated == ["studio"]
    assert "Created profile" in result.output


def test_config_create_profile_rejects_path_like_name(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", tmp_path / "configs")

    result = CliRunner().invoke(
        main,
        ["--config", str(tmp_path / "current.toml"), "config", "create-profile", "../studio"],
    )

    assert result.exit_code != 0
    assert "Invalid profile name" in result.output


def test_config_create_profile_refuses_existing_profile(
    tmp_path: Path,
    monkeypatch,
) -> None:
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    (configs_dir / "studio.toml").write_text("", encoding="utf-8")

    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", configs_dir)

    result = CliRunner().invoke(
        main,
        ["--config", str(tmp_path / "current.toml"), "config", "create-profile", "studio"],
    )

    assert result.exit_code != 0
    assert "Profile already exists" in result.output
