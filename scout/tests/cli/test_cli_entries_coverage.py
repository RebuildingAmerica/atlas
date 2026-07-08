"""Entries and export CLI coverage for atlas_scout.cli."""

from __future__ import annotations

import asyncio
import csv
import json
from typing import TYPE_CHECKING

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main
from atlas_scout.entries_commands import _entries_list
from atlas_scout.store import ScoutStore

from .entries_pages_support import (
    _capture_consoles,
    _make_config,
    _seed_duplicate_person_run,
    _seed_entries,
    _seed_other_run,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_entries_list_no_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = _capture_consoles(monkeypatch)
    config = _make_config(tmp_path)
    await _entries_list(config, 0.0, None, 50, "table")
    assert "No entries yet" in output.getvalue()


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
