"""Tests for the Atlas Scout CLI."""

from __future__ import annotations

import io
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
        lambda _config: SimpleNamespace(search_concurrency=1, fetch_concurrency=1, extract_concurrency=1),
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
        on_progress("entity_found", {"name": "Example Org", "entry_type": "organization", "url": "https://example.com/seed"})
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
        lambda _config: SimpleNamespace(search_concurrency=1, fetch_concurrency=1, extract_concurrency=1),
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
        on_progress("fetch_started", {"url": "https://example.com/seed", "task_id": "seed", "depth": 0})
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
        lambda _config: SimpleNamespace(search_concurrency=1, fetch_concurrency=1, extract_concurrency=1),
    )

    class DummyProvider:
        async def close(self) -> None:
            return None

    monkeypatch.setattr(cli_module, "_build_provider", lambda *_args, **_kwargs: DummyProvider())

    async def should_not_run(**_kwargs):
        raise AssertionError("run_pipeline should not start when a duplicate direct run is already active")

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
