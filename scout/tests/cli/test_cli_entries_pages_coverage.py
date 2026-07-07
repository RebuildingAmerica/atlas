"""Comprehensive coverage tests for atlas_scout.cli.

These tests cover code paths not exercised by ``test_cli.py`` or
``test_cli_profiles.py``: the ``run`` extra branches (provider/model/file
sources, quiet, follow-link overrides), the ``db``/``runs``/``entries``/
``pages``/``schedule``/``daemon`` commands' full behaviour, and assorted
helper functions.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
from typing import TYPE_CHECKING, Any

import pytest
from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
import atlas_scout.entries.browse as entries_browse_module
import atlas_scout.entries.export as entries_export_module
import atlas_scout.pages_commands as pages_module
from atlas_scout.cli import main
from atlas_scout.config import (
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
    StoreConfig,
)
from atlas_scout.entries_commands import _entries_list
from atlas_scout.pages_commands import _pages_list
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
    monkeypatch.setattr(
        entries_browse_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        entries_export_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        pages_module,
        "console",
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
        data={
            "issue_areas": ["housing"],
            "source_urls": ["https://src.example/bob"],
            "source_contexts": {"https://src.example/bob": "Bob Smith testified about rent."},
        },
    )
    await store.close()
    return run_id


async def _seed_other_run(config: ScoutConfig) -> str:
    """Seed a second run for run filtering tests."""
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Dallas, TX", issues=["public_transit"], search_depth="standard"
    )
    await store.save_entry(
        run_id=run_id,
        name="Dallas Organizer",
        entry_type="person",
        description="A transit organizer.",
        city="Dallas",
        state="TX",
        score=0.88,
        data={
            "issue_areas": ["public_transit"],
            "source_urls": ["https://src.example/dallas"],
            "source_contexts": {"https://src.example/dallas": "Dallas Organizer organized riders."},
        },
    )
    await store.close()
    return run_id


async def _seed_duplicate_person_run(config: ScoutConfig) -> str:
    """Seed a duplicate person with a higher score for unique-name review tests."""
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.save_entry(
        run_id=run_id,
        name="Bob Smith",
        entry_type="person",
        description="A more recent individual profile.",
        city=None,
        state=None,
        score=0.9,
        data={
            "issue_areas": ["housing"],
            "source_urls": ["https://src.example/bob-latest"],
            "source_contexts": {"https://src.example/bob-latest": "Bob Smith chaired the hearing."},
        },
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
    run_id = await _seed_entries(config)
    await _entries_list(config, 0.0, None, 50, "json")
    captured = capsys.readouterr()

    payload = json.loads(captured.out)
    assert isinstance(payload, list)
    assert payload[0]["name"] == "Acme Org"
    assert payload[0]["run_id"] == run_id
    assert payload[0]["website"] == "https://acme.example"
    assert payload[1]["source_contexts"] == {
        "https://src.example/bob": "Bob Smith testified about rent."
    }
    assert "source_dataset" in payload[0]


def test_entries_list_command_filters_run_and_random_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    asyncio.run(_seed_entries(config))
    run_id = asyncio.run(_seed_other_run(config))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "entries",
            "list",
            "--run-id",
            run_id,
            "--type",
            "person",
            "--random",
            "--limit",
            "1",
            "--format",
            "json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload == [
        {
            "run_id": run_id,
            "name": "Dallas Organizer",
            "entry_type": "person",
            "description": "A transit organizer.",
            "city": "Dallas",
            "state": "TX",
            "score": 0.88,
            "website": None,
            "email": None,
            "issue_areas": ["public_transit"],
            "source_urls": ["https://src.example/dallas"],
            "source_contexts": {"https://src.example/dallas": "Dallas Organizer organized riders."},
            "source_context": None,
            "source_dataset": None,
        }
    ]


def test_entries_list_command_accepts_multiple_run_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    first_run_id = asyncio.run(_seed_entries(config))
    second_run_id = asyncio.run(_seed_other_run(config))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "entries",
            "list",
            "--run-id",
            first_run_id,
            "--run-id",
            second_run_id,
            "--type",
            "person",
            "--limit",
            "10",
            "--format",
            "json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert [item["run_id"] for item in payload] == [first_run_id, second_run_id]
    assert [item["name"] for item in payload] == ["Bob Smith", "Dallas Organizer"]


def test_entries_list_command_can_dedupe_names_across_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    first_run_id = asyncio.run(_seed_entries(config))
    second_run_id = asyncio.run(_seed_duplicate_person_run(config))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "entries",
            "list",
            "--run-id",
            first_run_id,
            "--run-id",
            second_run_id,
            "--type",
            "person",
            "--unique-names",
            "--limit",
            "10",
            "--format",
            "json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert len(payload) == 1
    assert payload[0]["run_id"] == second_run_id
    assert payload[0]["name"] == "Bob Smith"
    assert payload[0]["score"] == 0.9


def test_export_entries_writes_provenance_rich_jsonl(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    first_run_id = asyncio.run(_seed_entries(config))
    second_run_id = asyncio.run(_seed_duplicate_person_run(config))
    export_path = tmp_path / "people.jsonl"
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "export",
            "entries",
            "--run-id",
            first_run_id,
            "--run-id",
            second_run_id,
            "--type",
            "person",
            "--unique-names",
            "--limit",
            "1",
            "--format",
            "jsonl",
            "--output",
            str(export_path),
        ],
    )

    assert result.exit_code == 0
    assert "Exported 1 entries" in result.output
    lines = export_path.read_text().splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["run_id"] == second_run_id
    assert payload["name"] == "Bob Smith"
    assert payload["source_urls"] == ["https://src.example/bob-latest"]
    assert payload["source_contexts"] == {
        "https://src.example/bob-latest": "Bob Smith chaired the hearing."
    }


def test_export_entries_stdout_json_exports_all_matches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    run_id = asyncio.run(_seed_entries(config))
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "export",
            "entries",
            "--type",
            "person",
            "--format",
            "json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert len(payload) == 1
    assert payload[0]["run_id"] == run_id
    assert payload[0]["name"] == "Bob Smith"
    assert payload[0]["local_entry_id"]
    assert "Exported" not in result.output


def test_export_entries_csv_preserves_source_fields(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    run_id = asyncio.run(_seed_entries(config))
    export_path = tmp_path / "entries.csv"
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "export",
            "entries",
            "--run-id",
            run_id,
            "--type",
            "person",
            "--format",
            "csv",
            "--output",
            str(export_path),
        ],
    )

    assert result.exit_code == 0
    rows = list(csv.DictReader(export_path.read_text().splitlines()))
    assert len(rows) == 1
    assert rows[0]["name"] == "Bob Smith"
    assert rows[0]["run_id"] == run_id
    assert rows[0]["source_urls"] == '["https://src.example/bob"]'
    assert json.loads(rows[0]["source_contexts"]) == {
        "https://src.example/bob": "Bob Smith testified about rent."
    }


def test_export_entries_reports_missing_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(main, ["export", "entries"])

    assert result.exit_code != 0
    assert "No entries yet. Run 'scout run' first." in result.output


def test_export_entries_rejects_missing_output_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    asyncio.run(_seed_entries(config))
    missing_path = tmp_path / "missing" / "entries.jsonl"
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)

    result = CliRunner().invoke(
        main,
        [
            "export",
            "entries",
            "--output",
            str(missing_path),
        ],
    )

    assert result.exit_code != 0
    assert f"Output directory does not exist: {missing_path.parent}" in result.output


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
