"""Scout schedule configuration command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

from atlas_scout.cli import main
from atlas_scout.config import load_config

if TYPE_CHECKING:
    from pathlib import Path


def test_config_schedule_set_updates_scalar_schedule_settings(tmp_path: Path) -> None:
    """Schedule scalar settings should have a domain command, not raw TOML editing."""
    config_path = tmp_path / "scout.toml"

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "config",
            "schedule",
            "set",
            "--enabled",
            "--cron",
            "*/30 * * * *",
            "--max-concurrent-runs",
            "3",
        ],
    )

    assert result.exit_code == 0, result.output
    config = load_config(config_path)
    assert config.schedule.enabled is True
    assert config.schedule.cron == "*/30 * * * *"
    assert config.schedule.max_concurrent_runs == 3


def test_config_schedule_target_add_and_list(tmp_path: Path) -> None:
    """Structured schedule targets should be editable through target commands."""
    config_path = tmp_path / "scout.toml"
    runner = CliRunner()

    add_result = runner.invoke(
        main,
        [
            "--config",
            str(config_path),
            "config",
            "schedule",
            "target",
            "add",
            "--location",
            "Austin, TX",
            "--issues",
            "housing_affordability,transportation",
            "--depth",
            "deep",
        ],
    )
    list_result = runner.invoke(
        main,
        ["--config", str(config_path), "config", "schedule", "target", "list"],
    )

    assert add_result.exit_code == 0, add_result.output
    assert list_result.exit_code == 0, list_result.output
    assert "1" in list_result.output
    assert "Austin, TX" in list_result.output
    assert "housing_affordability, transportation" in list_result.output
    assert "deep" in list_result.output
    config = load_config(config_path)
    assert len(config.schedule.targets) == 1
    assert config.schedule.targets[0].issues == ["housing_affordability", "transportation"]


def test_config_schedule_target_remove_uses_one_based_index(tmp_path: Path) -> None:
    """Removing target 1 should remove the first configured target."""
    config_path = tmp_path / "scout.toml"
    config_path.write_text(
        "\n".join(
            [
                "[[schedule.targets]]",
                'location = "Austin, TX"',
                'issues = ["housing"]',
                'search_depth = "standard"',
                "",
                "[[schedule.targets]]",
                'location = "Houston, TX"',
                'issues = ["healthcare"]',
                'search_depth = "deep"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "config", "schedule", "target", "remove", "1"],
    )

    assert result.exit_code == 0, result.output
    config = load_config(config_path)
    assert len(config.schedule.targets) == 1
    assert config.schedule.targets[0].location == "Houston, TX"


def test_config_schedule_target_clear_removes_all_targets(tmp_path: Path) -> None:
    """Clearing targets should leave schedule scalar settings intact."""
    config_path = tmp_path / "scout.toml"
    config_path.write_text(
        "\n".join(
            [
                "[schedule]",
                "enabled = true",
                'cron = "0 2 * * *"',
                "",
                "[[schedule.targets]]",
                'location = "Austin, TX"',
                'issues = ["housing"]',
                'search_depth = "standard"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "config", "schedule", "target", "clear"],
    )

    assert result.exit_code == 0, result.output
    config = load_config(config_path)
    assert config.schedule.enabled is True
    assert config.schedule.targets == []


def test_config_schedule_target_remove_rejects_missing_index(tmp_path: Path) -> None:
    """Out-of-range removals should fail without rewriting the profile."""
    config_path = tmp_path / "scout.toml"

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "config", "schedule", "target", "remove", "1"],
    )

    assert result.exit_code != 0
    assert "Schedule target not found" in result.output
    assert not config_path.exists()
