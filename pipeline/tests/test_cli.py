"""Tests for the Atlas Scout CLI."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from click.testing import CliRunner

from atlas_scout.cli import main


# ---------------------------------------------------------------------------
# Help output tests
# ---------------------------------------------------------------------------


def test_cli_help():
    result = CliRunner().invoke(main, ["--help"])
    assert result.exit_code == 0
    assert "Atlas Scout" in result.output or "atlas" in result.output.lower()


def test_cli_run_help():
    result = CliRunner().invoke(main, ["run", "--help"])
    assert result.exit_code == 0
    assert "--location" in result.output


def test_cli_runs_list_help():
    result = CliRunner().invoke(main, ["runs", "list", "--help"])
    assert result.exit_code == 0


def test_cli_runs_inspect_help():
    result = CliRunner().invoke(main, ["runs", "inspect", "--help"])
    assert result.exit_code == 0


# ---------------------------------------------------------------------------
# Required arguments
# ---------------------------------------------------------------------------


def test_cli_run_requires_location():
    result = CliRunner().invoke(main, ["run"])
    assert result.exit_code != 0


def test_cli_run_requires_issues():
    result = CliRunner().invoke(main, ["run", "--location", "Austin, TX"])
    assert result.exit_code != 0


def test_cli_run_missing_api_key_exits_nonzero():
    """When SEARCH_API_KEY is absent, the run command should exit with an error."""
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["run", "--location", "Austin, TX", "--issues", "housing_affordability"],
        env={"SEARCH_API_KEY": ""},
        catch_exceptions=False,
    )
    assert result.exit_code != 0


# ---------------------------------------------------------------------------
# Depth choice validation
# ---------------------------------------------------------------------------


def test_cli_run_invalid_depth():
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--location",
            "Austin, TX",
            "--issues",
            "housing",
            "--depth",
            "invalid",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0


# ---------------------------------------------------------------------------
# runs group
# ---------------------------------------------------------------------------


def test_cli_runs_group_help():
    result = CliRunner().invoke(main, ["runs", "--help"])
    assert result.exit_code == 0
    assert "list" in result.output
    assert "inspect" in result.output


def test_cli_runs_inspect_requires_run_id():
    result = CliRunner().invoke(main, ["runs", "inspect"])
    assert result.exit_code != 0


# ---------------------------------------------------------------------------
# Integration: run command with mocked pipeline
# ---------------------------------------------------------------------------


def test_cli_run_calls_pipeline(tmp_path):
    """run command should call _run_pipeline and print a status line."""
    from atlas_shared import GapReport
    from atlas_scout.pipeline import PipelineResult

    fake_result = PipelineResult(
        run_id="abc123",
        queries_generated=5,
        pages_fetched=0,
        entries_found=1,
        entries_after_dedup=1,
        ranked_entries=[],
        gap_report=GapReport(
            location="Austin, TX",
            total_entries=1,
            covered_issues=["housing_affordability"],
            missing_issues=[],
            thin_issues=[],
        ),
    )

    # Patch _run_pipeline at the module level so asyncio.run receives a coroutine
    async def fake_run(*args, **kwargs):
        return fake_result

    with patch("atlas_scout.cli._run_pipeline", side_effect=fake_run):
        runner = CliRunner()
        result = runner.invoke(
            main,
            [
                "run",
                "--location",
                "Austin, TX",
                "--issues",
                "housing_affordability",
                "--search-api-key",
                "test-key",
            ],
        )

    assert result.exit_code == 0
    assert "Austin, TX" in result.output
