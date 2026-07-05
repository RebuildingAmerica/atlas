"""Scout profile configuration command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from click.testing import CliRunner

from atlas_scout.cli import main

if TYPE_CHECKING:
    from pathlib import Path


def test_config_path_prints_active_config_path(tmp_path: Path) -> None:
    """`scout config path` should show the profile file Scout is using."""
    config_path = tmp_path / "scout.toml"

    result = CliRunner().invoke(main, ["--config", str(config_path), "config", "path"])

    assert result.exit_code == 0, result.output
    assert str(config_path) in result.output


def test_config_show_lists_non_secret_scalar_settings(tmp_path: Path) -> None:
    """Profile display should be complete for scalar config and silent about secrets."""
    config_path = tmp_path / "scout.toml"
    config_path.write_text(
        "\n".join(
            [
                "[llm]",
                'provider = "lmstudio"',
                'api_key = "secret-model-token"',
                "",
                "[contribution]",
                'api_key = "secret-atlas-token"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(main, ["--config", str(config_path), "config", "show"])

    assert result.exit_code == 0, result.output
    assert "llm.provider" in result.output
    assert "scraper.page_cache_ttl_days" in result.output
    assert "runtime.max_memory_percent" in result.output
    assert "pipeline.iterative_deepening" in result.output
    assert "schedule.cron" in result.output
    assert "contribution.atlas_url" in result.output
    assert "store.path" in result.output
    assert "api_key" not in result.output
    assert "secret-model-token" not in result.output
    assert "secret-atlas-token" not in result.output


def test_config_set_and_get_validated_scalar_values(tmp_path: Path) -> None:
    """The expert setter should update only known scalar profile fields."""
    config_path = tmp_path / "scout.toml"
    runner = CliRunner()

    set_fetches = runner.invoke(
        main,
        ["--config", str(config_path), "config", "set", "scraper.max_concurrent_fetches", "12"],
    )
    set_deepening = runner.invoke(
        main,
        ["--config", str(config_path), "config", "set", "pipeline.iterative_deepening", "true"],
    )
    get_fetches = runner.invoke(
        main,
        ["--config", str(config_path), "config", "get", "scraper.max_concurrent_fetches"],
    )

    assert set_fetches.exit_code == 0, set_fetches.output
    assert set_deepening.exit_code == 0, set_deepening.output
    assert get_fetches.exit_code == 0, get_fetches.output
    assert get_fetches.output.strip() == "12"
    text = config_path.read_text(encoding="utf-8")
    assert "max_concurrent_fetches = 12" in text
    assert "iterative_deepening = true" in text


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("nope.value", "Unknown config section"),
        ("scraper.nope", "Unknown config field"),
        ("schedule.targets", "scout config schedule target"),
        ("llm.api_key", "Secret config not saved"),
    ],
)
def test_config_set_rejects_non_scalar_or_unsafe_keys(
    key: str,
    expected: str,
    tmp_path: Path,
) -> None:
    """Generic config writes should reject unsafe or non-scalar paths."""
    config_path = tmp_path / "scout.toml"

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "config", "set", key, "value"],
    )

    assert result.exit_code != 0
    assert expected in result.output
    assert not config_path.exists()


def test_config_set_rejects_invalid_scalar_type(tmp_path: Path) -> None:
    """Type errors should be caught before TOML is written."""
    config_path = tmp_path / "scout.toml"

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "config",
            "set",
            "scraper.max_concurrent_fetches",
            "many",
        ],
    )

    assert result.exit_code != 0
    assert "Invalid config value" in result.output
    assert "integer" in result.output
    assert not config_path.exists()
