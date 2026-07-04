"""Comprehensive coverage tests for atlas_scout.cli.

These tests cover code paths not exercised by ``test_cli.py`` or
``test_cli_profiles.py``: the ``run`` extra branches (provider/model/file
sources, quiet, follow-link overrides), the ``db``/``runs``/``entries``/
``pages``/``schedule``/``daemon`` commands' full behaviour, and assorted
helper functions.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

import pytest
from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    ScoutSyncError,
    _resolve_sync_run_ids,
    _runs_inspect,
    _runs_list,
    _runs_sync,
    main,
)
from atlas_scout.config import (
    ContributionConfig,
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
async def test_resolve_sync_run_ids_rejects_explicit_all_ready(tmp_path: Path) -> None:
    with pytest.raises(ScoutSyncError, match="explicit run ids or --all-ready"):
        await _resolve_sync_run_ids(
            _make_config(tmp_path),
            run_ids=("run_1",),
            all_ready=True,
        )


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
async def test_runs_inspect_renders_page_task_without_detail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Page task rows with no entries or error still render cleanly."""
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    task_id = await store.create_page_task(run_id, "https://example.com/empty")
    await store.update_page_task(task_id, "completed")
    await store.close()

    await _runs_inspect(config, run_id)

    rendered = output.getvalue()
    assert "https://example.com/empty" in rendered
    assert "Pages" in rendered


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
    assert "Log in with `scout login` or pass --api-key" in output.getvalue()


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
        from atlas_shared import SyncedEntryLink

        from atlas_scout.steps.contribute import ContributionResult

        return ContributionResult(
            attempted=1,
            created=1,
            failed=0,
            errors=[],
            run_id="remote-123",
            sync_status="synced",
            duplicate=False,
            entry_links=[
                SyncedEntryLink(
                    id="entry_123",
                    name="Prairie Workers Cooperative",
                    type="organization",
                    slug="prairie-workers-cooperative-1234",
                    visibility="public",
                    url="/profiles/organizations/prairie-workers-cooperative-1234",
                )
            ],
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync)

    await _runs_sync(config, run_id, atlas_url="https://x", api_key="k")
    rendered = output.getvalue()
    assert "Synced" in rendered
    assert "remote-123" in rendered
    assert "Prairie Workers Cooperative" in rendered
    assert "https://x/profiles/organizations/prairie-workers-cooperative-1234" in rendered


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
