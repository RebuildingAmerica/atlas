"""Pages CLI coverage for atlas_scout.cli."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main
from atlas_scout.pages_commands import _pages_list
from atlas_scout.store import ScoutStore

from .entries_pages_support import _capture_consoles, _make_config

if TYPE_CHECKING:
    from pathlib import Path


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
