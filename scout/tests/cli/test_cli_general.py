"""General Atlas Scout CLI tests."""

from __future__ import annotations

import asyncio
import io
from unittest.mock import patch

import pytest
from click.testing import CliRunner
from rich.console import Console

from atlas_scout.cli import main


def test_cli_help() -> None:
    result = CliRunner().invoke(main, ["--help"])
    assert result.exit_code == 0
    assert "Atlas Scout" in result.output or "atlas" in result.output.lower()


def test_cli_run_help() -> None:
    result = CliRunner().invoke(main, ["run", "--help"])
    assert result.exit_code == 0
    assert "--location" in result.output
    assert "--target-count" in result.output


def test_cli_runs_list_help() -> None:
    result = CliRunner().invoke(main, ["runs", "list", "--help"])
    assert result.exit_code == 0


def test_cli_runs_inspect_help() -> None:
    result = CliRunner().invoke(main, ["runs", "inspect", "--help"])
    assert result.exit_code == 0


def test_cli_runs_sync_help() -> None:
    result = CliRunner().invoke(main, ["runs", "sync", "--help"])
    assert result.exit_code == 0
    assert "--target" in result.output
    assert "--workspace" in result.output


def test_cli_sync_help() -> None:
    result = CliRunner().invoke(main, ["sync", "--help"])
    assert result.exit_code == 0
    assert "--all-ready" in result.output
    assert "--target" in result.output


def test_cli_runs_cancel_help() -> None:
    result = CliRunner().invoke(main, ["runs", "cancel", "--help"])
    assert result.exit_code == 0


def test_cli_daemon_help() -> None:
    result = CliRunner().invoke(main, ["daemon", "--help"])
    assert result.exit_code == 0
    assert "start" in result.output
    assert "stop" in result.output
    assert "status" in result.output


def test_cli_run_requires_location() -> None:
    result = CliRunner().invoke(main, ["run"])
    assert result.exit_code != 0


def test_cli_run_requires_issues() -> None:
    result = CliRunner().invoke(main, ["run", "--location", "Austin, TX"])
    assert result.exit_code != 0


def test_cli_run_missing_api_key_exits_nonzero() -> None:
    """When SEARCH_API_KEY is absent, the run command should exit with an error."""
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["run", "--location", "Austin, TX", "--issues", "housing_affordability"],
        env={"SEARCH_API_KEY": ""},
        catch_exceptions=False,
    )
    assert result.exit_code != 0
    assert "Run could not start" in result.output
    assert "Connect search or build a local article corpus" in result.output


def test_cli_run_invalid_depth() -> None:
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


def test_cli_runs_group_help() -> None:
    result = CliRunner().invoke(main, ["runs", "--help"])
    assert result.exit_code == 0
    assert "list" in result.output
    assert "inspect" in result.output


def test_cli_runs_inspect_requires_run_id() -> None:
    result = CliRunner().invoke(main, ["runs", "inspect"])
    assert result.exit_code != 0


def test_cli_runs_sync_requires_run_id() -> None:
    result = CliRunner().invoke(main, ["runs", "sync"])
    assert result.exit_code != 0


def test_cli_runs_cancel_requires_run_id() -> None:
    result = CliRunner().invoke(main, ["runs", "cancel"])
    assert result.exit_code != 0


def test_cli_runs_cancel_updates_local_non_terminal_run_only(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(store=StoreConfig(path=str(tmp_path / "scout.db")))
    store = ScoutStore(config.store.path)
    asyncio.run(store.initialize())
    run_id = asyncio.run(
        store.create_run(location="Austin, TX", issues=["housing"], search_depth="standard")
    )
    asyncio.run(store.update_run_status(run_id, "running"))
    asyncio.run(store.close())

    with patch("atlas_scout.cli.load_config", return_value=config):
        result = CliRunner().invoke(
            main,
            ["--config", str(tmp_path / "scout.toml"), "runs", "cancel", run_id],
        )

    assert result.exit_code == 0
    rendered = output.getvalue()
    assert "Cancelled local run" in rendered
    assert "does not interrupt active work" in rendered

    async def fetch_run() -> dict[str, object]:
        persisted_store = ScoutStore(config.store.path)
        await persisted_store.initialize()
        try:
            return await persisted_store.get_run(run_id)
        finally:
            await persisted_store.close()

    persisted = asyncio.run(fetch_run())
    assert persisted["status"] == "cancelled"
    assert persisted["completed_at"] is not None


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
def test_cli_runs_cancel_refuses_terminal_runs(
    tmp_path, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(store=StoreConfig(path=str(tmp_path / "scout.db")))

    async def seed_run() -> tuple[str, dict[str, object]]:
        store = ScoutStore(config.store.path)
        await store.initialize()
        run_id = await store.create_run(
            location="Austin, TX", issues=["housing"], search_depth="standard"
        )
        if status == "completed":
            await store.complete_run(
                run_id,
                queries=1,
                pages_fetched=1,
                entries_found=1,
                entries_after_dedup=1,
            )
        elif status == "failed":
            await store.fail_run(run_id, "boom")
        else:
            await store.cancel_run(run_id, "already cancelled")
        record = await store.get_run(run_id)
        await store.close()
        return run_id, record

    run_id, before = asyncio.run(seed_run())

    with patch("atlas_scout.cli.load_config", return_value=config):
        result = CliRunner().invoke(
            main,
            ["--config", str(tmp_path / "scout.toml"), "runs", "cancel", run_id],
        )

    assert result.exit_code != 0
    assert f"already {status}" in output.getvalue().lower()

    async def fetch_run() -> dict[str, object]:
        store = ScoutStore(config.store.path)
        await store.initialize()
        try:
            return await store.get_run(run_id)
        finally:
            await store.close()

    after = asyncio.run(fetch_run())
    assert after["status"] == before["status"]
    assert after["completed_at"] == before["completed_at"]
    assert after["error"] == before["error"]


def test_cli_runs_cancel_reports_missing_run(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScoutConfig, StoreConfig

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(store=StoreConfig(path=str(tmp_path / "scout.db")))

    with patch("atlas_scout.cli.load_config", return_value=config):
        result = CliRunner().invoke(
            main,
            ["--config", str(tmp_path / "scout.toml"), "runs", "cancel", "missing-run"],
        )

    assert result.exit_code != 0
    assert "Run not found" in output.getvalue()
