"""Tests for the Atlas Scout CLI."""

from __future__ import annotations

import asyncio
import io
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from click.testing import CliRunner
from rich.console import Console

from atlas_scout.cli import _run_pipeline, main

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


def test_cli_runs_sync_help():
    result = CliRunner().invoke(main, ["runs", "sync", "--help"])
    assert result.exit_code == 0


def test_cli_daemon_help():
    result = CliRunner().invoke(main, ["daemon", "--help"])
    assert result.exit_code == 0
    assert "start" in result.output
    assert "stop" in result.output
    assert "status" in result.output


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


def test_cli_runs_sync_requires_run_id():
    result = CliRunner().invoke(main, ["runs", "sync"])
    assert result.exit_code != 0


# ---------------------------------------------------------------------------
# Integration: run command with mocked pipeline
# ---------------------------------------------------------------------------


def test_cli_run_calls_pipeline():
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
    async def fake_run(*_args, **_kwargs):
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


def test_cli_run_refresh_flag_reaches_runner():
    captured: dict[str, object] = {}

    async def fake_run(*_args, **kwargs):
        captured.update(kwargs)
        from atlas_shared import GapReport

        from atlas_scout.pipeline import PipelineResult

        return PipelineResult(
            run_id="abc123",
            queries_generated=0,
            pages_fetched=0,
            entries_found=0,
            entries_after_dedup=0,
            ranked_entries=[],
            gap_report=GapReport(location="Austin, TX", total_entries=0),
        )

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
                "--refresh",
            ],
        )

    assert result.exit_code == 0
    assert captured["refresh"] is True


def test_cli_run_verbose_progress_flag_reaches_runner():
    captured: dict[str, object] = {}

    async def fake_run(*_args, **kwargs):
        captured.update(kwargs)
        from atlas_shared import GapReport

        from atlas_scout.pipeline import PipelineResult

        return PipelineResult(
            run_id="abc123",
            queries_generated=0,
            pages_fetched=0,
            entries_found=0,
            entries_after_dedup=0,
            ranked_entries=[],
            gap_report=GapReport(location="Austin, TX", total_entries=0),
        )

    with patch("atlas_scout.cli._run_pipeline", side_effect=fake_run):
        runner = CliRunner()
        result = runner.invoke(
            main,
            [
                "run",
                "https://example.com",
                "--verbose-progress",
            ],
        )

    assert result.exit_code == 0
    assert captured["verbose_progress"] is True


@pytest.mark.asyncio
async def test_cli_progress_feed_uses_page_and_entity_events_only(tmp_path, monkeypatch):
    from atlas_shared import GapReport

    import atlas_scout.cli as cli_module
    import atlas_scout.pipeline as pipeline_module
    from atlas_scout.config import ScoutConfig, StoreConfig
    from atlas_scout.pipeline import PipelineResult

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "build_runtime_profile",
        lambda _config: SimpleNamespace(
            search_concurrency=1, fetch_concurrency=1, extract_concurrency=1
        ),
    )

    class DummyProvider:
        async def close(self) -> None:
            return None

    monkeypatch.setattr(cli_module, "_build_provider", lambda *_args, **_kwargs: DummyProvider())

    async def fake_run_pipeline(**kwargs):
        on_progress = kwargs["on_progress"]
        on_progress("page_found", {"url": "https://example.com/seed", "depth": 0})
        on_progress("frontier_queued", {"url": "https://example.com/internal", "depth": 1})
        on_progress("fetch_started", {"url": "https://example.com", "depth": 0})
        on_progress(
            "entity_found",
            {
                "name": "Example Org",
                "entry_type": "organization",
                "url": "https://example.com/seed",
            },
        )
        return PipelineResult(
            run_id="abc123",
            queries_generated=0,
            pages_fetched=1,
            entries_found=1,
            entries_after_dedup=1,
            ranked_entries=[],
            gap_report=GapReport(location="", total_entries=1),
            page_outcomes=[],
        )

    monkeypatch.setattr(pipeline_module, "run_pipeline", fake_run_pipeline)

    config = ScoutConfig(store=StoreConfig(path=str(tmp_path / "scout.db")))

    await _run_pipeline(
        config=config,
        location="",
        issues=[],
        depth="standard",
        search_api_key=None,
        direct_urls=["https://example.com"],
        quiet=False,
    )

    rendered = output.getvalue()

    assert "PAGE_FOUND" in rendered
    assert "ENTITY_FOUND" in rendered
    assert "Example Org" in rendered
    assert "FRONTIER_QUEUED" not in rendered
    assert "FETCH_STARTED" not in rendered
    assert "EXTRACT_STARTED" not in rendered
    assert "WORK_RECORDED" not in rendered


@pytest.mark.asyncio
async def test_cli_progress_feed_hides_internal_progress_by_default(tmp_path, monkeypatch):
    from atlas_shared import GapReport

    import atlas_scout.cli as cli_module
    import atlas_scout.pipeline as pipeline_module
    from atlas_scout.config import ScoutConfig, StoreConfig
    from atlas_scout.pipeline import PipelineResult

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "build_runtime_profile",
        lambda _config: SimpleNamespace(
            search_concurrency=1, fetch_concurrency=1, extract_concurrency=1
        ),
    )

    class DummyProvider:
        async def close(self) -> None:
            return None

    monkeypatch.setattr(cli_module, "_build_provider", lambda *_args, **_kwargs: DummyProvider())

    async def fake_run_pipeline(**kwargs):
        on_progress = kwargs["on_progress"]
        on_progress("page_found", {"url": "https://example.com/seed", "depth": 0})
        on_progress(
            "page_found",
            {
                "url": "https://example.com/seed",
                "depth": 0,
            },
        )
        on_progress(
            "page_found",
            {
                "url": "https://example.com/discovered",
                "depth": 1,
                "links_found": 10,
            },
        )
        on_progress(
            "fetch_started", {"url": "https://example.com/seed", "task_id": "seed", "depth": 0}
        )
        on_progress(
            "page_skipped",
            {
                "url": "https://example.com/discovered",
                "depth": 1,
                "reason": "no_entities_found",
            },
        )
        on_progress(
            "page_failed",
            {
                "url": "https://example.com/seed",
                "depth": 0,
                "reason": "provider_overloaded",
            },
        )
        on_progress(
            "entity_found",
            {
                "url": "https://example.com/seed",
                "name": "Example Org",
                "entry_type": "organization",
            },
        )
        return PipelineResult(
            run_id="abc123",
            queries_generated=0,
            pages_fetched=1,
            entries_found=1,
            entries_after_dedup=1,
            ranked_entries=[],
            gap_report=GapReport(location="", total_entries=1),
            page_outcomes=[],
        )

    monkeypatch.setattr(pipeline_module, "run_pipeline", fake_run_pipeline)

    config = ScoutConfig(store=StoreConfig(path=str(tmp_path / "scout.db")))

    await _run_pipeline(
        config=config,
        location="",
        issues=[],
        depth="standard",
        search_api_key=None,
        direct_urls=["https://example.com/seed"],
        quiet=False,
    )

    rendered = output.getvalue()

    assert rendered.count("PAGE_FOUND") == 3
    assert "PAGE_SKIPPED" in rendered
    assert "reason=no_entities_found" in rendered
    assert "PAGE_FAILED" in rendered
    assert "reason=provider_overloaded" in rendered
    assert "ENTITY_FOUND" in rendered
    assert "links_found=10" in rendered
    assert "FETCH_STARTED" not in rendered
    assert "EXTRACT_STARTED" not in rendered
    assert "FRONTIER_QUEUED" not in rendered
    assert "WORK_RECORDED" not in rendered


@pytest.mark.asyncio
async def test_cli_run_refuses_duplicate_active_direct_run(tmp_path, monkeypatch):
    import atlas_scout.cli as cli_module
    import atlas_scout.pipeline as pipeline_module
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
        "build_runtime_profile",
        lambda _config: SimpleNamespace(
            search_concurrency=1, fetch_concurrency=1, extract_concurrency=1
        ),
    )

    class DummyProvider:
        async def close(self) -> None:
            return None

    monkeypatch.setattr(cli_module, "_build_provider", lambda *_args, **_kwargs: DummyProvider())

    async def should_not_run(**_kwargs):
        raise AssertionError(
            "run_pipeline should not start when a duplicate direct run is already active"
        )

    monkeypatch.setattr(pipeline_module, "run_pipeline", should_not_run)

    config = ScoutConfig(store=StoreConfig(path=str(tmp_path / "scout.db")))
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(location="", issues=[], search_depth="standard")
    await store.update_run_status(run_id, "running")
    await store.create_page_task(run_id, "https://example.com/seed")
    await store.close()

    await _run_pipeline(
        config=config,
        location="",
        issues=[],
        depth="standard",
        search_api_key=None,
        direct_urls=["https://example.com/seed"],
        quiet=False,
    )

    rendered = output.getvalue()
    assert "Active run already exists" in rendered
    assert run_id in rendered


def test_cli_daemon_start_refuses_duplicate_active_daemon(tmp_path, monkeypatch):
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    async def seed_state() -> None:
        store = ScoutStore(str(tmp_path / "scout.db"))
        await store.initialize()
        await store.start_daemon(
            config_path=str(tmp_path / "scout.toml"),
            profile_name=None,
            target_count=1,
            process_id=4321,
            interval_seconds=86400,
            interval_basis="cron 0 2 * * *",
        )
        await store.close()

    asyncio.run(seed_state())

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

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )

    with (
        patch("atlas_scout.cli.load_config", return_value=config),
        patch("atlas_scout.cli._daemon_process_is_running", return_value=True),
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
            ],
        )

    assert result.exit_code != 0
    rendered = output.getvalue()
    assert "already running" in rendered.lower()
    assert "4321" in rendered


def test_cli_daemon_start_launches_internal_runner_with_search_key(tmp_path, monkeypatch):
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig

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

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    async def fake_wait_for_start(*_args, **_kwargs):
        return {
            "status": "running",
            "process_id": 4321,
        }

    with (
        patch("atlas_scout.cli.load_config", return_value=config),
        patch("atlas_scout.cli._daemon_process_is_running", return_value=False),
        patch("atlas_scout.cli.subprocess.Popen", return_value=FakePopen()) as popen,
        patch("atlas_scout.cli._wait_for_daemon_start", side_effect=fake_wait_for_start),
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
                "--interval",
                "300",
            ],
        )

    assert result.exit_code == 0
    command = popen.call_args.args[0]
    env = popen.call_args.kwargs["env"]
    assert command[:3] == [sys.executable, "-m", "atlas_scout.cli"]
    assert command[-4:] == ["daemon", "run-internal", "--interval", "300"]
    assert env["SEARCH_API_KEY"] == "test-key"
    assert "Daemon started" in output.getvalue()


@pytest.mark.asyncio
async def test_daemon_stop_terminates_tracked_process_and_updates_state(tmp_path, monkeypatch):
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
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

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name=None,
        target_count=1,
        process_id=4321,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.close()

    seen_signals: list[int] = []
    running_checks = iter([True, False])

    monkeypatch.setattr(
        cli_module,
        "_daemon_process_is_running",
        lambda _pid: next(running_checks),
    )
    monkeypatch.setattr(
        cli_module,
        "_signal_daemon_process",
        lambda pid: seen_signals.append(pid),
    )

    await cli_module._daemon_stop(config)

    store = ScoutStore(config.store.path)
    await store.initialize()
    daemon_state = await store.get_daemon_state()
    await store.close()

    assert seen_signals == [4321]
    assert daemon_state["status"] == "stopped"
    assert daemon_state["process_id"] is None
    assert "Daemon stopped" in output.getvalue()


@pytest.mark.asyncio
async def test_daemon_stop_reconciles_state_when_process_exits_before_signal(tmp_path, monkeypatch):
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name=None,
        target_count=1,
        process_id=4321,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.close()

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)
    monkeypatch.setattr(
        cli_module,
        "_signal_daemon_process",
        lambda _pid: (_ for _ in ()).throw(ProcessLookupError()),
    )

    await cli_module._daemon_stop(config)

    store = ScoutStore(config.store.path)
    await store.initialize()
    daemon_state = await store.get_daemon_state()
    await store.close()

    assert daemon_state["status"] == "stopped"
    assert daemon_state["process_id"] is None
    assert "exited before stop signal" in output.getvalue()


@pytest.mark.asyncio
async def test_daemon_status_prints_runtime_and_recent_run_summary(tmp_path, monkeypatch):
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(
        schedule=ScheduleConfig(
            cron="0 */6 * * *",
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])],
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name="default",
        target_count=1,
        process_id=4321,
        interval_seconds=21600,
        interval_basis="cron 0 */6 * * *",
    )
    run_id = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    await store.complete_run(
        run_id,
        queries=4,
        pages_fetched=12,
        entries_found=5,
        entries_after_dedup=4,
    )
    await store.record_daemon_tick_result(
        status="completed",
        run_count=1,
        summary="1 scheduled run completed",
    )
    await store.close()

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)

    await cli_module._daemon_status(config)

    rendered = output.getvalue()
    assert "running" in rendered.lower()
    assert "4321" in rendered
    assert "cron 0 */6 * * *" in rendered
    assert "1 scheduled run completed" in rendered
    assert run_id in rendered
