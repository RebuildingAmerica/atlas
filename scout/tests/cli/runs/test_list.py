from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import _runs_list, main
from atlas_scout.store import ScoutStore

from .helpers import _capture_consoles, _make_config


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


def test_runs_list_command_invokes_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _p: _make_config(tmp_path))
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["runs", "list"])
    assert result.exit_code == 0
    assert "No runs found" in output.getvalue()
