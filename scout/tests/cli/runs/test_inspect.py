from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import ScoutSyncError, _resolve_sync_run_ids, _runs_inspect, main
from atlas_scout.store import ScoutStore

from .helpers import _capture_consoles, _make_config


@pytest.mark.asyncio
async def test_resolve_sync_run_ids_rejects_explicit_all_ready(
    tmp_path: Path,
) -> None:
    with pytest.raises(ScoutSyncError, match="explicit run ids or --all-ready"):
        await _resolve_sync_run_ids(
            _make_config(tmp_path),
            run_ids=("run_1",),
            all_ready=True,
        )


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
            run=DiscoveryRunInput(
                location_query="Austin, TX",
                state="TX",
                issue_areas=["housing"],
            ),
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
            run=DiscoveryRunInput(
                location_query="Austin, TX",
                state="TX",
                issue_areas=["housing"],
            ),
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
    assert "pending" in rendered
    assert "Remote run" not in rendered
    assert "Sync error" not in rendered


def test_runs_inspect_command_invokes_helper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["runs", "inspect", "missing"])
    assert result.exit_code != 0
    assert "Run not found" in output.getvalue()
