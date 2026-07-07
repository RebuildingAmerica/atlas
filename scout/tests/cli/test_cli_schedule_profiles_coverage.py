"""Comprehensive coverage tests for atlas_scout.cli.

These tests cover code paths not exercised by ``test_cli.py`` or
``test_cli_profiles.py``: the ``run`` extra branches (provider/model/file
sources, quiet, follow-link overrides), the ``db``/``runs``/``entries``/
``pages``/``schedule``/``daemon`` commands' full behaviour, and assorted
helper functions.
"""

from __future__ import annotations

import io
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

import pytest
from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    _schedule_run_once,
    _schedule_start,
    main,
)
from atlas_scout.config import (
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
    StoreConfig,
)
from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from pathlib import Path

DEFAULT_CRON = "0 2 * * *"


def _capture_consoles(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
    """Redirect both module consoles into a single buffer for assertions."""
    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def _make_config(tmp_path: Path, **overrides: Any) -> ScoutConfig:
    """Return a ScoutConfig pinned to a tmp DB."""
    base: dict[str, Any] = {"store": StoreConfig(path=str(tmp_path / "scout.db"))}
    base.update(overrides)
    return ScoutConfig(**base)


def _scheduled_config(tmp_path: Path) -> ScoutConfig:
    """ScoutConfig with one schedule target and tmp DB."""
    return _make_config(
        tmp_path,
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing"])]
        ),
    )


# ---------------------------------------------------------------------------
# init / root group
# ---------------------------------------------------------------------------


def test_schedule_run_once_no_targets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["schedule", "run-once", "--search-api-key", "k"])
    assert result.exit_code == 0
    rendered = output.getvalue()
    assert "No schedule targets" in rendered
    assert "Add targets" in rendered


def test_schedule_run_once_runs_targets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _scheduled_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)

    async def fake_run_schedule_once(_config: ScoutConfig, _key: str) -> list[str]:
        return ["run-1", "run-2"]

    import atlas_scout.scheduler as scheduler_module

    monkeypatch.setattr(scheduler_module, "run_schedule_once", fake_run_schedule_once)
    result = CliRunner().invoke(main, ["schedule", "run-once", "--search-api-key", "k"])
    assert result.exit_code == 0
    rendered = output.getvalue()
    assert "run-1" in rendered
    assert "run-2" in rendered
    assert "Completed 2 runs" in rendered


@pytest.mark.asyncio
async def test_schedule_run_once_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import atlas_scout.scheduler as scheduler_module

    async def fake(_config: ScoutConfig, _key: str) -> list[str]:
        return ["x"]

    monkeypatch.setattr(scheduler_module, "run_schedule_once", fake)
    assert await _schedule_run_once(_scheduled_config(tmp_path), "k") == ["x"]


def test_schedule_start_no_targets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["schedule", "start", "--search-api-key", "k"])
    assert result.exit_code == 0
    assert "No schedule targets" in output.getvalue()


def test_schedule_start_aborts_cleanly_on_keyboard_interrupt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _scheduled_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)

    async def fake_run_schedule_loop(*_args: Any, **_kwargs: Any) -> None:
        raise KeyboardInterrupt

    import atlas_scout.scheduler as scheduler_module

    monkeypatch.setattr(scheduler_module, "run_schedule_loop", fake_run_schedule_loop)
    result = CliRunner().invoke(main, ["schedule", "start", "--search-api-key", "k"])
    assert result.exit_code != 0
    assert "Aborted!" in result.output
    assert "Scheduler stopped" not in output.getvalue()


@pytest.mark.asyncio
async def test_schedule_start_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import atlas_scout.scheduler as scheduler_module

    captured: dict[str, Any] = {}

    async def fake(_config: ScoutConfig, key: str, *, interval_seconds: int) -> None:
        captured["interval"] = interval_seconds
        captured["key"] = key

    monkeypatch.setattr(scheduler_module, "run_schedule_loop", fake)
    await _schedule_start(_scheduled_config(tmp_path), "k", 99)
    assert captured["interval"] == 99
    assert captured["key"] == "k"


# ---------------------------------------------------------------------------
# Coverage for narrow branches
# ---------------------------------------------------------------------------


def test_profile_flag_missing_when_no_other_profiles_exist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the branch where requested profile is missing AND no others exist."""
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    monkeypatch.setattr("atlas_scout.config.paths.SCOUT_CONFIGS_DIR", configs_dir)
    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", configs_dir)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["--profile", "missing", "config", "show"])
    assert result.exit_code != 0
    rendered = output.getvalue()
    assert "missing" in rendered
    # No "Available profiles" line because there are none.
    assert "Available profiles" not in rendered


def test_use_profile_missing_when_no_profiles_exist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    monkeypatch.setattr("atlas_scout.config.paths.SCOUT_CONFIGS_DIR", configs_dir)
    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", configs_dir)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "use-profile", "missing"])
    assert result.exit_code != 0
    rendered = output.getvalue()
    assert "missing" in rendered
    assert "Available profiles" not in rendered


@pytest.mark.asyncio
async def test_run_pipeline_refresh_skips_duplicate_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When refresh=True, the duplicate-direct-run check should be skipped (line 333->340)."""
    from atlas_shared import GapReport

    import atlas_scout.pipeline as pipeline_module
    from atlas_scout.pipeline import PipelineResult

    output = _capture_consoles(monkeypatch)

    monkeypatch.setattr(
        cli_module,
        "build_runtime_profile",
        lambda _config, **_kwargs: SimpleNamespace(
            search_concurrency=1, fetch_concurrency=1, extract_concurrency=1
        ),
    )

    class DummyProvider:
        async def close(self) -> None:
            return None

    monkeypatch.setattr(cli_module, "_build_provider", lambda *_a, **_k: DummyProvider())

    async def fake_run_pipeline(**_kwargs: Any) -> Any:
        return PipelineResult(
            run_id="abc",
            queries_generated=0,
            pages_fetched=0,
            entries_found=0,
            entries_after_dedup=0,
            ranked_entries=[],
            gap_report=GapReport(location="", total_entries=0),
        )

    monkeypatch.setattr(pipeline_module, "run_pipeline", fake_run_pipeline)
    config = _make_config(tmp_path)

    # Seed a duplicate run that would normally be detected.
    store = ScoutStore(config.store.path)
    await store.initialize()
    rid = await store.create_run(location="", issues=[], search_depth="standard")
    await store.update_run_status(rid, "running")
    await store.create_page_task(rid, "https://example.com/seed")
    await store.close()

    from atlas_scout.cli import _run_pipeline

    await _run_pipeline(
        config=config,
        location="",
        issues=[],
        depth="standard",
        search_api_key=None,
        direct_urls=["https://example.com/seed"],
        quiet=True,
        refresh=True,  # bypass duplicate check
    )
    rendered = output.getvalue()
    # No duplicate notice should appear because refresh bypasses it.
    assert "Active run already exists" not in rendered
