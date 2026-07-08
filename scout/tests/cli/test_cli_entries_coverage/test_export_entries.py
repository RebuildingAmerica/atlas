"""Entries export CLI coverage for atlas_scout.cli."""

from __future__ import annotations

import asyncio
import csv
import json
from typing import TYPE_CHECKING

import pytest  # noqa: TC002
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main

from ..entries_pages_support import _make_config, _seed_duplicate_person_run, _seed_entries

if TYPE_CHECKING:
    from pathlib import Path


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
            "--run-id",
            run_id,
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
