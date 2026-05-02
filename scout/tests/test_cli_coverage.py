"""Comprehensive coverage tests for atlas_scout.cli.

These tests cover code paths not exercised by ``test_cli.py`` or
``test_cli_profiles.py``: the ``run`` extra branches (provider/model/file
sources, quiet, follow-link overrides), the ``db``/``runs``/``entries``/
``pages``/``schedule``/``daemon`` commands' full behaviour, and assorted
helper functions.
"""

from __future__ import annotations

import io
import logging
import signal
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    _build_provider,
    _clear_failed_daemon_start,
    _daemon_interval_metadata,
    _daemon_process_is_running,
    _daemon_run_internal,
    _daemon_start,
    _daemon_start_claim_is_stale,
    _daemon_start_conflict_message,
    _daemon_status,
    _daemon_stop,
    _entries_list,
    _open_store,
    _pages_list,
    _render_recent_run_summary,
    _render_recent_tick_summary,
    _resolved_profile_name,
    _runs_inspect,
    _runs_list,
    _runs_sync,
    _runtime_profile_for_run,
    _schedule_run_once,
    _schedule_start,
    _signal_daemon_process,
    _spawn_daemon_process,
    _wait_for_daemon_start,
    _wait_for_daemon_stop,
    main,
)
from atlas_scout.config import (
    ContributionConfig,
    LLMConfig,
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
    StoreConfig,
)
from atlas_scout.store import ScoutStore

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


def test_resolved_profile_name_returns_explicit() -> None:
    assert (
        _resolved_profile_name(
            explicit_config_path="/x/y.toml",
            requested_profile_name="studio",
            loaded_path=Path("/x/y.toml"),
        )
        == "studio"
    )


def test_resolved_profile_name_uses_active_when_no_explicit_path() -> None:
    with patch("atlas_scout.cli.get_active_profile_name", return_value="default"):
        assert (
            _resolved_profile_name(
                explicit_config_path=None,
                requested_profile_name=None,
                loaded_path=Path("/anything.toml"),
            )
            == "default"
        )


def test_resolved_profile_name_returns_stem_in_configs_dir(tmp_path: Path) -> None:
    fake_dir = tmp_path / "configs"
    fake_dir.mkdir()
    loaded = fake_dir / "studio.toml"
    loaded.write_text("")
    with patch.object(cli_module, "SCOUT_CONFIGS_DIR", fake_dir):
        assert (
            _resolved_profile_name(
                explicit_config_path=str(loaded),
                requested_profile_name=None,
                loaded_path=loaded,
            )
            == "studio"
        )


def test_resolved_profile_name_returns_none_for_outside_paths(tmp_path: Path) -> None:
    fake_dir = tmp_path / "configs"
    fake_dir.mkdir()
    other = tmp_path / "other.toml"
    other.write_text("")
    with patch.object(cli_module, "SCOUT_CONFIGS_DIR", fake_dir):
        assert (
            _resolved_profile_name(
                explicit_config_path=str(other),
                requested_profile_name=None,
                loaded_path=other,
            )
            is None
        )


def test_runtime_profile_for_run_falls_back_when_no_kw(monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel = SimpleNamespace(search_concurrency=1, fetch_concurrency=1, extract_concurrency=1)

    def fake_build(_config: Any, **_kwargs: Any) -> Any:
        if _kwargs:
            raise TypeError("legacy signature")
        return sentinel

    monkeypatch.setattr(cli_module, "build_runtime_profile", fake_build)
    assert _runtime_profile_for_run(_make_config(Path("/tmp")), direct_mode=True) is sentinel


def test_main_debug_flag_configures_logging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """--debug should set the root logger to DEBUG."""
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    # Reset handlers so basicConfig actually applies during invocation.
    root = logging.getLogger()
    original_level = root.level
    original_handlers = root.handlers[:]
    root.handlers.clear()
    try:
        result = CliRunner().invoke(main, ["--debug", "config", "show"])
        assert result.exit_code == 0
        assert root.level == logging.DEBUG
    finally:
        root.handlers.clear()
        root.handlers.extend(original_handlers)
        root.setLevel(original_level)


# ---------------------------------------------------------------------------
# run command — extra branches
# ---------------------------------------------------------------------------


def test_run_overrides_provider_and_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """--provider and --model should mutate the loaded config before running."""
    captured: dict[str, Any] = {}

    async def fake_pipeline(*, config: ScoutConfig, **kwargs: Any) -> Any:
        captured["provider"] = config.llm.provider
        captured["model"] = config.llm.model
        captured["search_api_key"] = kwargs.get("search_api_key")
        captured["direct_urls"] = kwargs.get("direct_urls")
        return None

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)

    result = CliRunner().invoke(
        main,
        [
            "run",
            "--provider",
            "anthropic",
            "--model",
            "claude-sonnet",
            "--quiet",
            "https://example.com",
        ],
    )
    assert result.exit_code == 0
    assert captured["provider"] == "anthropic"
    assert captured["model"] == "claude-sonnet"
    assert captured["direct_urls"] == ["https://example.com"]


def test_run_reads_urls_and_prompt_from_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """URLs from --file (with comments) and prompt from --prompt-file should be merged."""
    url_file = tmp_path / "urls.txt"
    url_file.write_text("https://a.com\n# comment\n\nhttps://b.com\n")
    prompt_file = tmp_path / "prompt.txt"
    prompt_file.write_text("Find legal aid orgs   \n")

    captured: dict[str, Any] = {}

    async def fake_pipeline(*, config: ScoutConfig, **kwargs: Any) -> Any:  # noqa: ARG001
        captured.update(kwargs)
        return None

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)

    result = CliRunner().invoke(
        main,
        [
            "run",
            "-f",
            str(url_file),
            "--prompt-file",
            str(prompt_file),
            "--quiet",
            "--follow-links",
            "--max-link-depth",
            "5",
            "--max-pages-per-seed",
            "11",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured["direct_urls"] == ["https://a.com", "https://b.com"]
    assert captured["directive"] == "Find legal aid orgs"


def test_run_no_urls_no_search_key_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(main, ["run"], env={"SEARCH_API_KEY": ""})
    assert result.exit_code != 0
    assert "Usage:" in result.output


def test_run_search_mode_missing_location(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--issues",
            "housing",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0
    assert "--location required" in result.output


def test_run_search_mode_missing_issues(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--location",
            "Austin, TX",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0
    assert "--issues required" in result.output


# ---------------------------------------------------------------------------
# _build_provider
# ---------------------------------------------------------------------------


def test_build_provider_invokes_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel = object()
    captured: dict[str, Any] = {}

    def fake_create(llm_config: Any, *, max_concurrent: int | None = None) -> Any:
        captured["llm"] = llm_config
        captured["max_concurrent"] = max_concurrent
        return sentinel

    import atlas_scout.providers as providers_module

    monkeypatch.setattr(providers_module, "create_provider", fake_create)
    config = ScoutConfig(llm=LLMConfig(provider="ollama", model="gemma"))
    assert _build_provider(config, max_concurrent=7) is sentinel
    assert captured["max_concurrent"] == 7
    assert captured["llm"] is config.llm


# ---------------------------------------------------------------------------
# db commands
# ---------------------------------------------------------------------------


def test_db_path_prints_db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["db", "path"])
    assert result.exit_code == 0
    assert config.store.path in output.getvalue()


def test_db_reset_cancelled_when_user_declines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    Path(config.store.path).write_text("existing")
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset"], input="n\n")
    assert result.exit_code == 0
    assert "Cancelled" in result.output
    assert Path(config.store.path).exists()


def test_db_reset_deletes_existing_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    Path(config.store.path).write_text("data")
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset", "--yes"])
    assert result.exit_code == 0
    assert "Deleted" in result.output
    assert "Database reset" in result.output
    assert not Path(config.store.path).exists()


def test_db_reset_yes_when_no_db_file_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["db", "reset", "-y"])
    assert result.exit_code == 0
    assert "Database reset" in result.output


# ---------------------------------------------------------------------------
# config commands (set / get / show)
# ---------------------------------------------------------------------------


def test_config_set_invalid_key_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "set", "no_dot", "value"])
    assert result.exit_code != 0
    assert "section.field" in output.getvalue()


def test_config_set_writes_string_int_float_bool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target_config_path = tmp_path / "scout.toml"
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "get_active_config_path", lambda: target_config_path)

    runner = CliRunner()
    assert runner.invoke(main, ["config", "set", "llm.model", "gemma3n:latest"]).exit_code == 0
    assert runner.invoke(main, ["config", "set", "llm.max_concurrent", "12"]).exit_code == 0
    assert runner.invoke(main, ["config", "set", "llm.timeout_seconds", "1.5"]).exit_code == 0
    assert runner.invoke(main, ["config", "set", "scraper.follow_links", "true"]).exit_code == 0
    assert (
        runner.invoke(main, ["config", "set", "scraper.revisit_cached_urls", "false"]).exit_code
        == 0
    )

    text = target_config_path.read_text()
    assert 'model = "gemma3n:latest"' in text
    assert "max_concurrent = 12" in text
    assert "timeout_seconds = 1.5" in text
    assert "follow_links = true" in text
    assert "revisit_cached_urls = false" in text


def test_config_set_preserves_existing_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target_config_path = tmp_path / "scout.toml"
    target_config_path.write_text('[llm]\nprovider = "ollama"\n')
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "get_active_config_path", lambda: target_config_path)
    result = CliRunner().invoke(main, ["config", "set", "llm.model", "gemma"])
    assert result.exit_code == 0
    text = target_config_path.read_text()
    assert 'provider = "ollama"' in text
    assert 'model = "gemma"' in text


def test_config_get_returns_value(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path, llm=LLMConfig(provider="ollama", model="gemma"))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.model"])
    assert result.exit_code == 0
    assert "gemma" in result.output


def test_config_get_invalid_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "get", "no_dot"])
    assert result.exit_code != 0
    assert "section.field" in output.getvalue()


def test_config_get_unknown_section(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["config", "get", "nope.thing"])
    assert result.exit_code != 0
    assert "Unknown section" in output.getvalue()


def test_config_get_redacts_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(
        tmp_path, llm=LLMConfig(provider="anthropic", model="claude", api_key="secret")
    )
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.api_key"])
    assert result.exit_code == 0
    assert "secret" not in result.output
    assert "***" in result.output


def test_config_get_returns_not_set_when_value_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path, llm=LLMConfig(provider="ollama", model="m", base_url=None))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.base_url"])
    assert result.exit_code == 0
    assert "not set" in result.output


def test_config_get_api_key_when_unset_shows_not_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    result = CliRunner().invoke(main, ["config", "get", "llm.api_key"])
    assert result.exit_code == 0
    assert "not set" in result.output


# ---------------------------------------------------------------------------
# runs commands (list / inspect / sync)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_runs_list_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    await _runs_list(config, limit=5)
    assert "No runs found" in output.getvalue()


@pytest.mark.asyncio
async def test_runs_list_renders_table(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.complete_run(
        run_id, queries=1, pages_fetched=2, entries_found=3, entries_after_dedup=2
    )
    await store.close()

    await _runs_list(config, limit=10)
    rendered = output.getvalue()
    assert run_id in rendered
    assert "Austin" in rendered


@pytest.mark.asyncio
async def test_runs_inspect_full_record(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.update_run_status(run_id, "running")
    task_id = await store.create_page_task(run_id, "https://example.com/seed")
    await store.update_page_task(task_id, "completed", entries_extracted=2)
    failed_task_id = await store.create_page_task(run_id, "https://example.com/fail")
    await store.update_page_task(failed_task_id, "failed", error="timeout")
    await store.save_entry(
        run_id=run_id,
        name="Acme Org",
        entry_type="organization",
        description="An org",
        city="Austin",
        state="TX",
        score=0.9,
        data={"website": "https://acme.example"},
    )
    await store.complete_run(
        run_id, queries=1, pages_fetched=1, entries_found=1, entries_after_dedup=1
    )
    await store.fail_run(run_id, "errored later")
    await store.close()

    await _runs_inspect(config, run_id)
    rendered = output.getvalue()
    assert run_id in rendered
    assert "Austin" in rendered
    assert "errored later" in rendered
    assert "Pages" in rendered
    assert "2 entries" in rendered
    assert "timeout" in rendered
    assert "Acme Org" in rendered


@pytest.mark.asyncio
async def test_runs_inspect_renders_sync_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When stored artifacts include sync info, inspect prints sync details."""
    from atlas_shared import (
        DiscoveryRunArtifacts,
        DiscoveryRunInput,
        DiscoveryRunManifest,
        DiscoveryRunStatus,
        DiscoverySyncInfo,
    )

    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(location_query="Austin, TX", state="TX", issue_areas=["housing"]),
            status=DiscoveryRunStatus.COMPLETED,
            sync=DiscoverySyncInfo(
                local_run_id=run_id,
                remote_run_id="remote-1",
                sync_status="synced",
                last_error="prior failure",
            ),
        ),
    )
    await store.save_run_artifacts(run_id, artifacts)
    await store.close()

    await _runs_inspect(config, run_id)
    rendered = output.getvalue()
    assert "Sync:" in rendered
    assert "remote-1" in rendered
    assert "prior failure" in rendered
    assert "No entries" in rendered


@pytest.mark.asyncio
async def test_runs_inspect_missing_run_exits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    with pytest.raises(SystemExit):
        await _runs_inspect(config, "missing")
    assert "Run not found" in output.getvalue()


# Sync command branches


@pytest.mark.asyncio
async def test_runs_sync_requires_atlas_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path, contribution=ContributionConfig(api_key="", atlas_url=""))
    with pytest.raises(SystemExit):
        await _runs_sync(config, "any", atlas_url=None, api_key="key")
    assert "Atlas URL required" in output.getvalue()


@pytest.mark.asyncio
async def test_runs_sync_requires_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path, contribution=ContributionConfig(api_key="", atlas_url=""))
    with pytest.raises(SystemExit):
        await _runs_sync(config, "any", atlas_url="https://atlas.test", api_key=None)
    assert "API key required" in output.getvalue()


@pytest.mark.asyncio
async def test_runs_sync_run_not_found(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    with pytest.raises(SystemExit):
        await _runs_sync(config, "missing", atlas_url="https://x", api_key="k")
    assert "Run not found" in output.getvalue()


async def _seed_run_with_artifacts(config: ScoutConfig) -> str:
    """Seed a run with a minimal artifact bundle so sync calls don't trip on missing data."""
    from atlas_shared import (
        DiscoveryRunArtifacts,
        DiscoveryRunInput,
        DiscoveryRunManifest,
        DiscoveryRunStatus,
    )

    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(location_query="Austin, TX", state="TX", issue_areas=["housing"]),
            status=DiscoveryRunStatus.COMPLETED,
        ),
    )
    await store.save_run_artifacts(run_id, artifacts)
    await store.close()
    return run_id


@pytest.mark.asyncio
async def test_runs_sync_artifacts_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.close()
    with pytest.raises(SystemExit):
        await _runs_sync(config, run_id, atlas_url="https://x", api_key="k")
    assert "Run artifacts missing" in output.getvalue()


@pytest.mark.asyncio
async def test_runs_sync_handles_remote_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)

    async def fake_sync(_artifacts: Any, *, atlas_url: str, api_key: str) -> Any:  # noqa: ARG001
        from atlas_scout.steps.contribute import ContributionResult

        return ContributionResult(
            attempted=1, created=0, failed=1, errors=["boom"], run_id=None, sync_status=None
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync)

    with pytest.raises(SystemExit):
        await _runs_sync(config, run_id, atlas_url="https://x", api_key="k")
    assert "Sync failed" in output.getvalue()


@pytest.mark.asyncio
async def test_runs_sync_success_reports_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)

    async def fake_sync(_artifacts: Any, *, atlas_url: str, api_key: str) -> Any:  # noqa: ARG001
        from atlas_scout.steps.contribute import ContributionResult

        return ContributionResult(
            attempted=1,
            created=1,
            failed=0,
            errors=[],
            run_id="remote-123",
            sync_status="synced",
            duplicate=False,
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync)

    await _runs_sync(config, run_id, atlas_url="https://x", api_key="k")
    rendered = output.getvalue()
    assert "Synced" in rendered
    assert "remote-123" in rendered


@pytest.mark.asyncio
async def test_runs_sync_duplicate_message(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)

    async def fake_sync(_artifacts: Any, *, atlas_url: str, api_key: str) -> Any:  # noqa: ARG001
        from atlas_scout.steps.contribute import ContributionResult

        return ContributionResult(
            attempted=1,
            created=0,
            failed=0,
            errors=[],
            run_id="remote-123",
            sync_status=None,
            duplicate=True,
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync)

    await _runs_sync(config, run_id, atlas_url="https://x", api_key="k")
    assert "Already synced" in output.getvalue()


def test_runs_list_command_invokes_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["runs", "list"])
    assert result.exit_code == 0
    assert "No runs found" in output.getvalue()


def test_runs_inspect_command_invokes_helper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["runs", "inspect", "missing"])
    assert result.exit_code != 0
    assert "Run not found" in output.getvalue()


def test_runs_sync_command_invokes_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(
        main,
        ["runs", "sync", "missing", "--atlas-url", "https://x", "--api-key", "k"],
    )
    assert result.exit_code != 0
    assert "Run not found" in output.getvalue()


# ---------------------------------------------------------------------------
# entries commands
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_entries_list_no_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    await _entries_list(config, 0.0, None, 50, "table")
    assert "No entries yet" in output.getvalue()


async def _seed_entries(config: ScoutConfig) -> str:
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.save_entry(
        run_id=run_id,
        name="Acme Org",
        entry_type="organization",
        description="An organization",
        city="Austin",
        state="TX",
        score=0.95,
        data={
            "website": "https://acme.example",
            "email": "info@acme.example",
            "issue_areas": ["housing", "legal"],
            "source_urls": ["https://src.example"],
        },
    )
    await store.save_entry(
        run_id=run_id,
        name="Bob Smith",
        entry_type="person",
        description="An individual",
        city=None,
        state=None,
        score=0.5,
        data={},
    )
    await store.close()
    return run_id


@pytest.mark.asyncio
async def test_entries_list_table(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    await _seed_entries(config)
    await _entries_list(config, 0.0, None, 50, "table")
    rendered = output.getvalue()
    assert "Acme Org" in rendered
    assert "Bob Smith" in rendered


@pytest.mark.asyncio
async def test_entries_list_table_truncated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    await _seed_entries(config)
    await _entries_list(config, 0.0, None, 1, "table")
    rendered = output.getvalue()
    assert "and 1 more" in rendered


@pytest.mark.asyncio
async def test_entries_list_filtered_by_type(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    await _seed_entries(config)
    await _entries_list(config, 0.0, "organization", 50, "table")
    rendered = output.getvalue()
    assert "Acme Org" in rendered
    assert "Bob Smith" not in rendered


@pytest.mark.asyncio
async def test_entries_list_json_output(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    config = _make_config(tmp_path)
    await _seed_entries(config)
    await _entries_list(config, 0.0, None, 50, "json")
    captured = capsys.readouterr()
    import json

    payload = json.loads(captured.out)
    assert isinstance(payload, list)
    assert payload[0]["name"] == "Acme Org"
    assert payload[0]["website"] == "https://acme.example"


@pytest.mark.asyncio
async def test_entries_list_csv_output(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    config = _make_config(tmp_path)
    await _seed_entries(config)
    await _entries_list(config, 0.0, None, 50, "csv")
    captured = capsys.readouterr()
    assert "name,entry_type" in captured.out
    assert "Acme Org" in captured.out
    assert "housing;legal" in captured.out


@pytest.mark.asyncio
async def test_entries_list_empty_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    await _entries_list(config, 0.0, None, 50, "json")
    captured = capsys.readouterr()
    assert captured.out.strip() == "[]"


@pytest.mark.asyncio
async def test_entries_list_empty_csv_silent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    output = _capture_consoles(monkeypatch)
    await _entries_list(config, 0.0, None, 50, "csv")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert output.getvalue() == ""


@pytest.mark.asyncio
async def test_entries_list_empty_table_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    await _entries_list(config, 0.0, None, 50, "table")
    assert "No entries found" in output.getvalue()


def test_entries_list_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["entries", "list"])
    assert result.exit_code == 0
    assert "No entries yet" in output.getvalue()


# ---------------------------------------------------------------------------
# pages commands
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pages_list_no_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    await _pages_list(config, 50)
    assert "No pages yet" in output.getvalue()


@pytest.mark.asyncio
async def test_pages_list_renders_page_tasks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    success = await store.create_page_task(run_id, "https://example.com/seed")
    await store.update_page_task(success, "completed", entries_extracted=2)
    failed = await store.create_page_task(run_id, "https://example.com/fail")
    await store.update_page_task(failed, "failed", error="timeout")
    await store.close()

    await _pages_list(config, 10)
    rendered = output.getvalue()
    assert "2 entries" in rendered
    assert "timeout" in rendered


@pytest.mark.asyncio
async def test_pages_list_falls_back_to_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When there are no page tasks, the cached pages table should be rendered."""
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.cache_page("https://example.com/x", "body", {"title": "Example title"})
    await store.close()

    await _pages_list(config, 10)
    rendered = output.getvalue()
    assert "Example title" in rendered
    assert "https://example.com/x" in rendered


@pytest.mark.asyncio
async def test_pages_list_no_tasks_no_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    await _pages_list(config, 10)
    assert "No pages yet" in output.getvalue()


def test_pages_list_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["pages", "list"])
    assert result.exit_code == 0
    assert "No pages yet" in output.getvalue()


# ---------------------------------------------------------------------------
# daemon helpers + commands
# ---------------------------------------------------------------------------


def test_daemon_process_is_running_handles_pid_zero() -> None:
    assert _daemon_process_is_running(0) is False


def test_daemon_process_is_running_alive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module.os, "kill", lambda _pid, _sig: None)
    assert _daemon_process_is_running(123) is True


def test_daemon_process_is_running_lookup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_pid: int, _sig: int) -> None:
        raise ProcessLookupError

    monkeypatch.setattr(cli_module.os, "kill", boom)
    assert _daemon_process_is_running(123) is False


def test_daemon_process_is_running_permission_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_pid: int, _sig: int) -> None:
        raise PermissionError

    monkeypatch.setattr(cli_module.os, "kill", boom)
    assert _daemon_process_is_running(123) is True


def test_signal_daemon_process_uses_killpg(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}
    monkeypatch.setattr(cli_module.os, "killpg", lambda pid, sig: seen.update(pid=pid, sig=sig))
    _signal_daemon_process(4321)
    assert seen == {"pid": 4321, "sig": signal.SIGTERM}


def test_signal_daemon_process_falls_back_to_kill(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(cli_module.os, "killpg", raising=False)
    seen: dict[str, Any] = {}
    monkeypatch.setattr(cli_module.os, "kill", lambda pid, sig: seen.update(pid=pid, sig=sig))
    _signal_daemon_process(4321)
    assert seen == {"pid": 4321, "sig": signal.SIGTERM}


def test_spawn_daemon_process_builds_command(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakePopen:
        pid = 1234

        def __init__(self, command: list[str], **kwargs: Any) -> None:
            captured["command"] = command
            captured["kwargs"] = kwargs

    monkeypatch.setattr(cli_module.subprocess, "Popen", FakePopen)
    process = _spawn_daemon_process(
        config_path=Path("/tmp/scout.toml"),
        debug=True,
        search_api_key="key",
        interval=300,
    )
    assert process.pid == 1234
    command = captured["command"]
    assert "--debug" in command
    assert "--interval" in command
    assert command[-1] == "300"
    assert captured["kwargs"]["env"]["SEARCH_API_KEY"] == "key"


def test_spawn_daemon_process_no_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakePopen:
        pid = 1234

        def __init__(self, command: list[str], **kwargs: Any) -> None:
            captured["command"] = command
            captured["kwargs"] = kwargs

    monkeypatch.setattr(cli_module.subprocess, "Popen", FakePopen)
    _spawn_daemon_process(
        config_path=Path("/tmp/scout.toml"),
        debug=False,
        search_api_key="key",
        interval=0,
    )
    assert "--debug" not in captured["command"]
    assert "--interval" not in captured["command"]


@pytest.mark.asyncio
async def test_wait_for_daemon_start_succeeds(tmp_path: Path) -> None:
    config = _scheduled_config(tmp_path)
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

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    state = await _wait_for_daemon_start(
        config,
        expected_pid=4321,
        process=FakePopen(),  # type: ignore[arg-type]
        timeout_seconds=1.0,
        poll_interval_seconds=0.01,
    )
    assert state["status"] == "running"


@pytest.mark.asyncio
async def test_wait_for_daemon_start_process_dies(tmp_path: Path) -> None:
    """If the spawned process exits before the store reports ready, raise a click error."""
    import click as click_module

    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()

    class FakePopen:
        pid = 4321

        def poll(self) -> int:
            return 1

    with pytest.raises(click_module.ClickException):
        await _wait_for_daemon_start(
            config,
            expected_pid=4321,
            process=FakePopen(),  # type: ignore[arg-type]
            timeout_seconds=0.5,
            poll_interval_seconds=0.01,
        )


@pytest.mark.asyncio
async def test_wait_for_daemon_start_times_out(tmp_path: Path) -> None:
    import click as click_module

    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    with pytest.raises(click_module.ClickException):
        await _wait_for_daemon_start(
            config,
            expected_pid=4321,
            process=FakePopen(),  # type: ignore[arg-type]
            timeout_seconds=0.1,
            poll_interval_seconds=0.01,
        )


@pytest.mark.asyncio
async def test_wait_for_daemon_stop_observes_state(tmp_path: Path) -> None:
    config = _scheduled_config(tmp_path)
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
    # Already stopped state when waiter starts.
    await store.stop_daemon()

    state = await _wait_for_daemon_stop(
        store, process_id=4321, timeout_seconds=1.0, poll_interval_seconds=0.01
    )
    assert state["status"] == "stopped"
    await store.close()


@pytest.mark.asyncio
async def test_wait_for_daemon_stop_reconciles_dead_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _scheduled_config(tmp_path)
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

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)
    state = await _wait_for_daemon_stop(
        store, process_id=4321, timeout_seconds=1.0, poll_interval_seconds=0.01
    )
    assert state["status"] == "stopped"
    await store.close()


@pytest.mark.asyncio
async def test_wait_for_daemon_stop_times_out(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import click as click_module

    config = _scheduled_config(tmp_path)
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
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)
    with pytest.raises(click_module.ClickException):
        await _wait_for_daemon_stop(
            store, process_id=4321, timeout_seconds=0.1, poll_interval_seconds=0.01
        )
    await store.close()


def test_render_recent_run_summary_none() -> None:
    assert _render_recent_run_summary(None) == "none recorded"


def test_render_recent_run_summary_full() -> None:
    summary = _render_recent_run_summary(
        {"id": "abc", "location": "Austin, TX", "status": "completed", "entries_found": 7}
    )
    assert "abc" in summary
    assert "completed" in summary
    assert "7 entries" in summary


def test_render_recent_run_summary_handles_non_int_entries() -> None:
    summary = _render_recent_run_summary(
        {"id": "abc", "location": None, "status": None, "entries_found": "bad"}
    )
    assert "0 entries" in summary
    assert "—" in summary


def test_render_recent_tick_summary_missing() -> None:
    assert _render_recent_tick_summary({}) == "none recorded"
    assert _render_recent_tick_summary({"last_tick_summary": "not a dict"}) == "none recorded"


def test_render_recent_tick_summary_with_completion() -> None:
    summary = _render_recent_tick_summary(
        {
            "last_tick_summary": {
                "summary": "1 run completed",
                "completed_at": "2025-01-01T01:02:03+00:00",
            }
        }
    )
    assert "1 run completed" in summary
    assert "2025-01-01T01:02:03" in summary


def test_render_recent_tick_summary_no_completion() -> None:
    assert _render_recent_tick_summary({"last_tick_summary": {"summary": "ok"}}) == "ok"


def test_daemon_interval_metadata_with_override(tmp_path: Path) -> None:
    interval, basis = _daemon_interval_metadata(_make_config(tmp_path), interval=300)
    assert interval == 300
    assert "fixed" in basis


def test_daemon_interval_metadata_uses_cron(tmp_path: Path) -> None:
    config = _make_config(tmp_path, schedule=ScheduleConfig(cron=DEFAULT_CRON))
    interval, basis = _daemon_interval_metadata(config, interval=0)
    assert interval > 0
    assert basis == f"cron {DEFAULT_CRON}"


def test_daemon_start_conflict_message_running() -> None:
    msg = _daemon_start_conflict_message({"status": "running", "process_id": 12})
    assert "PID 12" in msg


def test_daemon_start_conflict_message_starting() -> None:
    msg = _daemon_start_conflict_message({"status": "starting", "process_id": None})
    assert "already being started" in msg


def test_daemon_start_conflict_message_other() -> None:
    msg = _daemon_start_conflict_message({"status": "stopped", "process_id": None})
    assert "state changed" in msg


def test_daemon_start_claim_is_stale_not_starting() -> None:
    assert _daemon_start_claim_is_stale({"status": "running"}) is False


def test_daemon_start_claim_is_stale_missing_updated_at() -> None:
    assert _daemon_start_claim_is_stale({"status": "starting"}) is False


def test_daemon_start_claim_is_stale_invalid_timestamp() -> None:
    assert _daemon_start_claim_is_stale({"status": "starting", "updated_at": "not-a-date"}) is False


def test_daemon_start_claim_is_stale_naive_timestamp_is_stale() -> None:
    """A naive timestamp far in the past should still be considered stale."""
    assert (
        _daemon_start_claim_is_stale(
            {"status": "starting", "updated_at": "2000-01-01T00:00:00"},
        )
        is True
    )


def test_daemon_start_claim_is_stale_recent_is_not_stale() -> None:
    from datetime import UTC
    from datetime import datetime as _dt

    now = _dt.now(UTC).isoformat()
    assert _daemon_start_claim_is_stale({"status": "starting", "updated_at": now}) is False


@pytest.mark.asyncio
async def test_clear_failed_daemon_start_releases_starting_claim(tmp_path: Path) -> None:
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.claim_daemon_start(
        config_path=str(tmp_path / "scout.toml"),
        profile_name=None,
        target_count=1,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.close()

    await _clear_failed_daemon_start(config, expected_pid=None)

    store = ScoutStore(config.store.path)
    await store.initialize()
    state = await store.get_daemon_state()
    await store.close()
    assert state["status"] == "stopped"


@pytest.mark.asyncio
async def test_clear_failed_daemon_start_clears_running_with_dead_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _scheduled_config(tmp_path)
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

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)
    await _clear_failed_daemon_start(config, expected_pid=4321)

    store = ScoutStore(config.store.path)
    await store.initialize()
    state = await store.get_daemon_state()
    await store.close()
    assert state["status"] == "stopped"


@pytest.mark.asyncio
async def test_open_store_returns_initialized_store(tmp_path: Path) -> None:
    config = _make_config(tmp_path)
    store = await _open_store(config)
    tables = await store.list_tables()
    await store.close()
    assert "runs" in tables


# Daemon command branches that the existing test_cli.py does not hit


def test_daemon_start_requires_targets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "start", "--search-api-key", "k"])
    assert result.exit_code != 0
    assert "schedule targets" in output.getvalue().lower()


def test_daemon_stop_command_when_not_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _scheduled_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "stop"])
    assert result.exit_code == 0
    assert "not running" in output.getvalue().lower()


@pytest.mark.asyncio
async def test_daemon_stop_with_missing_pid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When daemon state has no PID, stop should reconcile."""
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    # Force "running" status with no PID via direct SQL.
    await store._execute(
        "INSERT INTO daemon_state (key, status, process_id, target_count, "
        "interval_seconds, interval_basis, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET status = excluded.status, "
        "process_id = excluded.process_id, target_count = excluded.target_count, "
        "interval_seconds = excluded.interval_seconds, "
        "interval_basis = excluded.interval_basis, "
        "updated_at = excluded.updated_at",
        ("scout", "running", None, 1, 300, "x", "2025-01-01T00:00:00+00:00"),
    )
    await store.close()
    await _daemon_stop(config)
    rendered = output.getvalue()
    assert "had no PID" in rendered or "reconciled" in rendered


@pytest.mark.asyncio
async def test_daemon_stop_with_already_dead_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
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
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)

    await _daemon_stop(config)
    rendered = output.getvalue()
    assert "already gone" in rendered.lower()


def test_daemon_status_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _scheduled_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "status"])
    assert result.exit_code == 0
    assert "Scout daemon" in output.getvalue()


@pytest.mark.asyncio
async def test_daemon_status_shows_stale_for_dead_pid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the tracked PID is gone, status should render as 'stale'."""
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name="default",
        target_count=2,
        process_id=4321,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.record_daemon_heartbeat()
    await store.close()
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)
    await _daemon_status(config)
    rendered = output.getvalue()
    assert "stale" in rendered
    assert "default" in rendered
    assert "Last heartbeat" in rendered


@pytest.mark.asyncio
async def test_daemon_status_uses_config_targets_when_state_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When state has no target_count, fall back to len(config.schedule.targets)."""
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    await _daemon_status(config)
    rendered = output.getvalue()
    assert "Targets: 1" in rendered


def test_daemon_run_internal_command_requires_targets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "run-internal", "--search-api-key", "k"])
    assert result.exit_code != 0
    assert "schedule targets" in output.getvalue().lower()


@pytest.mark.asyncio
async def test_daemon_run_internal_invokes_loop(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_daemon_run_internal should configure handlers and call run_schedule_loop."""
    captured: dict[str, Any] = {}

    async def fake_run_schedule_loop(
        _config: ScoutConfig,
        api_key: str,
        *,
        interval_seconds: int,
        lifecycle: Any,
        stop_event: Any,
    ) -> None:
        captured["interval"] = interval_seconds
        captured["api_key"] = api_key
        captured["lifecycle"] = lifecycle
        captured["stop_event"] = stop_event

    import atlas_scout.scheduler as scheduler_module

    monkeypatch.setattr(scheduler_module, "run_schedule_loop", fake_run_schedule_loop)
    monkeypatch.setattr(
        cli_module,
        "_install_daemon_signal_handlers",
        lambda _evt: captured.setdefault("installed", True),
    )
    config = _scheduled_config(tmp_path)
    await _daemon_run_internal(
        config,
        config_path=tmp_path / "scout.toml",
        profile_name="profile",
        search_api_key="key",
        interval=42,
    )
    assert captured["interval"] == 42
    assert captured["api_key"] == "key"
    assert captured["installed"] is True


def test_install_daemon_signal_handlers_uses_loop_when_supported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import atlas_scout.cli as mod

    class FakeLoop:
        def __init__(self) -> None:
            self.added: list[tuple[Any, Any]] = []

        def add_signal_handler(self, sig: Any, callback: Any) -> None:
            self.added.append((sig, callback))

        def call_soon_threadsafe(
            self, _callback: Any, *_args: Any
        ) -> None:  # pragma: no cover - unused
            raise AssertionError("threadsafe should not be called when add_signal_handler succeeds")

    class FakeEvent:
        def set(self) -> None:  # pragma: no cover - exercised via callbacks elsewhere
            pass

    loop = FakeLoop()
    monkeypatch.setattr(mod.asyncio, "get_running_loop", lambda: loop)
    mod._install_daemon_signal_handlers(FakeEvent())  # type: ignore[arg-type]
    assert {sig for sig, _ in loop.added} == {signal.SIGTERM, signal.SIGINT}
    # Trigger the registered callback to cover the inner closure.
    loop.added[0][1]()


# ---------------------------------------------------------------------------
# schedule commands
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


def test_schedule_start_loops_until_keyboard_interrupt(
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
    assert result.exit_code == 0
    assert "Scheduler stopped" in output.getvalue()


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
    monkeypatch.setattr("atlas_scout.config.SCOUT_CONFIGS_DIR", configs_dir)
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
    monkeypatch.setattr("atlas_scout.config.SCOUT_CONFIGS_DIR", configs_dir)
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


@pytest.mark.asyncio
async def test_runs_inspect_minimal_record(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Inspect a run with no location, no completed_at, no error, no entries, no page tasks."""
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(location="", issues=["housing"], search_depth="standard")
    await store.close()

    await _runs_inspect(config, run_id)
    rendered = output.getvalue()
    assert run_id in rendered
    # No location line, no completed_at line, no error line.
    assert "Location:" not in rendered
    assert "Completed:" not in rendered
    assert "Error:" not in rendered
    assert "No entries" in rendered


@pytest.mark.asyncio
async def test_runs_inspect_sync_without_remote_or_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover sync branches for present sync info without remote_run_id or last_error."""
    from atlas_shared import (
        DiscoveryRunArtifacts,
        DiscoveryRunInput,
        DiscoveryRunManifest,
        DiscoveryRunStatus,
        DiscoverySyncInfo,
    )

    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(location_query="Austin, TX", state="TX", issue_areas=["housing"]),
            status=DiscoveryRunStatus.COMPLETED,
            sync=DiscoverySyncInfo(
                local_run_id=run_id,
                remote_run_id=None,
                sync_status=None,
                last_error=None,
            ),
        ),
    )
    await store.save_run_artifacts(run_id, artifacts)
    await store.close()

    await _runs_inspect(config, run_id)
    rendered = output.getvalue()
    # sync_status falsy -> "pending"
    assert "pending" in rendered
    # No remote run line
    assert "Remote run" not in rendered
    assert "Sync error" not in rendered


@pytest.mark.asyncio
async def test_runs_inspect_page_task_without_details(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the page_task render branch where entries=0 and error is None (665->667)."""
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    task_id = await store.create_page_task(run_id, "https://example.com/queued")
    await store.update_page_task(task_id, "queued", entries_extracted=0)
    await store.close()

    await _runs_inspect(config, run_id)
    rendered = output.getvalue()
    assert "https://example.com/queued" in rendered


@pytest.mark.asyncio
async def test_pages_list_renders_task_with_no_entries_or_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the page-task path where entries_extracted=0 and error is missing."""
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    task_id = await store.create_page_task(run_id, "https://example.com/empty")
    await store.update_page_task(task_id, "completed", entries_extracted=0)
    await store.close()
    await _pages_list(config, 10)
    rendered = output.getvalue()
    assert "https://example.com/empty" in rendered


@pytest.mark.asyncio
async def test_daemon_start_clears_stale_running_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When daemon was 'running' but the PID is dead, claim should reclaim with a notice."""
    config = _scheduled_config(tmp_path)

    output = _capture_consoles(monkeypatch)

    async def seed() -> None:
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

    await seed()

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)

    class FakePopen:
        pid = 9999

        def poll(self) -> None:
            return None

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        return {"status": "running", "process_id": 9999}

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)

    await _daemon_start(
        config,
        config_path=tmp_path / "scout.toml",
        profile_name=None,
        debug=False,
        search_api_key="k",
        interval=300,
    )
    rendered = output.getvalue()
    assert "stale daemon state" in rendered.lower()
    assert "4321" in rendered  # the cleared PID


@pytest.mark.asyncio
async def test_daemon_start_clears_stale_running_state_without_pid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Stale 'running' branch when tracked_pid is not an int (line 1238)."""
    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class StubStore:
        def __init__(self) -> None:
            self.calls = 0

        async def get_daemon_state(self) -> dict[str, Any]:
            self.calls += 1
            # First call is during pre-claim check; subsequent calls won't matter.
            return {
                "status": "running",
                "process_id": None,  # not an int -> hit non-int branch
                "updated_at": "2025-01-01T00:00:00+00:00",
            }

        async def claim_daemon_start(self, **_kwargs: Any) -> bool:
            return True

        async def close(self) -> None:
            return None

    stub = StubStore()

    async def fake_open_store(_config: ScoutConfig) -> Any:
        return stub

    monkeypatch.setattr(cli_module, "_open_store", fake_open_store)

    class FakePopen:
        pid = 9999

        def poll(self) -> None:
            return None

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        return {"status": "running", "process_id": 9999}

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)

    await _daemon_start(
        config,
        config_path=tmp_path / "scout.toml",
        profile_name=None,
        debug=False,
        search_api_key="k",
        interval=300,
    )
    rendered = output.getvalue()
    # Branch where tracked_pid is not int -> "Cleared stale daemon state before restart"
    assert "Cleared stale daemon state before restart" in rendered


@pytest.mark.asyncio
async def test_daemon_start_signal_on_spawn_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the path where _wait_for_daemon_start fails and the live process gets SIGTERMed."""
    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class FakePopen:
        pid = 7777

        def poll(self) -> None:
            return None

    seen_signals: list[int] = []

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise RuntimeError("never ready")

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)
    monkeypatch.setattr(cli_module, "_signal_daemon_process", lambda pid: seen_signals.append(pid))

    with pytest.raises(RuntimeError):
        await _daemon_start(
            config,
            config_path=tmp_path / "scout.toml",
            profile_name=None,
            debug=False,
            search_api_key="k",
            interval=300,
        )
    assert seen_signals == [7777]
    # Output not asserted; cleanup happened.
    _ = output


@pytest.mark.asyncio
async def test_daemon_start_signal_handles_lookup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the suppress(ProcessLookupError) branch when the process disappears mid-cleanup."""
    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class FakePopen:
        pid = 5555

        def poll(self) -> None:
            return None

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise RuntimeError("never ready")

    def boom(_pid: int) -> None:
        raise ProcessLookupError

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)
    monkeypatch.setattr(cli_module, "_signal_daemon_process", boom)

    with pytest.raises(RuntimeError):
        await _daemon_start(
            config,
            config_path=tmp_path / "scout.toml",
            profile_name=None,
            debug=False,
            search_api_key="k",
            interval=300,
        )
    _ = output


# ---------------------------------------------------------------------------
# Daemon start happy path: unclaimed conflict + spawn cleanup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_start_returns_conflict_when_claim_lost(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If claim_daemon_start fails (race), surface the conflict message."""
    import click as click_module

    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class StubStore:
        async def get_daemon_state(self) -> dict[str, Any]:
            return {"status": "stopped", "process_id": None, "updated_at": "x"}

        async def claim_daemon_start(self, **_kwargs: Any) -> bool:
            return False

        async def close(self) -> None:
            return None

    async def fake_open_store(_config: ScoutConfig) -> Any:
        return StubStore()

    monkeypatch.setattr(cli_module, "_open_store", fake_open_store)

    # Patch the second call: simplest way is to swap the method after the first call.
    call_count = {"n": 0}

    async def get_state(_self: StubStore) -> dict[str, Any]:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"status": "stopped", "process_id": None, "updated_at": "x"}
        return {"status": "running", "process_id": 4321}

    StubStore.get_daemon_state = get_state  # type: ignore[assignment]

    with pytest.raises(click_module.ClickException) as info:
        await _daemon_start(
            config,
            config_path=tmp_path / "scout.toml",
            profile_name=None,
            debug=False,
            search_api_key="k",
            interval=300,
        )
    assert "PID 4321" in info.value.message
    # Reset attribute so other tests don't see the stub.
    _ = output  # ensure capture didn't crash; nothing else expected
