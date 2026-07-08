from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import _runs_sync, main
from atlas_scout.config import ContributionConfig
from atlas_scout.store import ScoutStore

from .helpers import _capture_consoles, _make_config, _seed_run_with_artifacts


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
async def test_runs_sync_requires_api_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    monkeypatch.setattr(cli_module, "load_session", lambda: None)
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

    async def fake_sync(_artifacts, *, atlas_url: str, api_key: str):  # noqa: ANN001, ARG001
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

    async def fake_sync(_artifacts, *, atlas_url: str, api_key: str):  # noqa: ANN001, ARG001
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

    async def fake_sync(_artifacts, *, atlas_url: str, api_key: str):  # noqa: ANN001, ARG001
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


def test_runs_sync_command_invokes_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(
        main,
        ["runs", "sync", "missing", "--atlas-url", "https://x", "--api-key", "k"],
    )
    assert result.exit_code != 0
    assert "Run not found" in output.getvalue()
