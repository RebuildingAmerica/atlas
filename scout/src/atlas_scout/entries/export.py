"""Entry export for Scout."""

from __future__ import annotations

import csv
import json
import sys
from typing import TYPE_CHECKING, Any

import click

from atlas_scout.cli_context import console
from atlas_scout.entries.query import (
    _dedupe_entries_by_name,
    _load_entries,
    _select_entries_for_output,
)

if TYPE_CHECKING:
    from pathlib import Path

    from atlas_scout.config import ScoutConfig

_ENTRY_EXPORT_CSV_FIELDS = [
    "local_entry_id",
    "run_id",
    "name",
    "entry_type",
    "description",
    "city",
    "state",
    "score",
    "website",
    "email",
    "issue_areas",
    "source_urls",
    "source_contexts",
    "source_context",
    "source_dataset",
    "source_key",
    "last_seen",
    "source_dates",
    "created_at",
]


async def _export_entries(
    config: ScoutConfig,
    min_score: float,
    entry_type: str | None,
    limit: int,
    output_format: str,
    output: Path | None,
    *,
    run_ids: tuple[str, ...] = (),
    random_sample: bool = False,
    unique_names: bool = False,
) -> None:
    """Export entries in a file-friendly format while preserving provenance."""
    try:
        all_entries = await _load_entries(config, min_score=min_score, run_ids=run_ids)
    except FileNotFoundError as exc:
        raise click.ClickException("No entries yet. Run 'scout run' first.") from exc

    if entry_type:
        all_entries = [entry for entry in all_entries if entry["entry_type"] == entry_type]
    if unique_names:
        all_entries = _dedupe_entries_by_name(all_entries)

    selected_entries = _select_entries_for_output(
        all_entries,
        limit=limit,
        random_sample=random_sample,
        unlimited_when_zero=True,
    )
    rows = [_entry_export_row(entry) for entry in selected_entries]

    if output is None:
        _write_entry_export(rows, output_format, sys.stdout)
        return

    output_path = output.expanduser()
    if not output_path.parent.exists():
        raise click.ClickException(f"Output directory does not exist: {output_path.parent}")
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        _write_entry_export(rows, output_format, handle)
    console.print(f"Exported {len(rows)} entries to {output_path}")


def _entry_export_row(entry: dict[str, Any]) -> dict[str, Any]:
    """Return a provenance-preserving export row for one local entry."""
    data = entry.get("data", {})
    data = data if isinstance(data, dict) else {}
    return {
        "local_entry_id": entry.get("id"),
        "run_id": entry.get("run_id"),
        "name": entry["name"],
        "entry_type": entry["entry_type"],
        "description": entry.get("description", ""),
        "city": entry.get("city"),
        "state": entry.get("state"),
        "score": entry["score"],
        "website": data.get("website"),
        "email": data.get("email"),
        "issue_areas": data.get("issue_areas", []),
        "source_urls": data.get("source_urls", []),
        "source_contexts": data.get("source_contexts", {}),
        "source_context": data.get("source_context"),
        "source_dataset": data.get("source_dataset"),
        "source_key": data.get("source_key"),
        "last_seen": data.get("last_seen"),
        "source_dates": data.get("source_dates", []),
        "created_at": entry.get("created_at"),
    }


def _write_entry_export(rows: list[dict[str, Any]], output_format: str, handle: Any) -> None:
    """Write entry export rows to a text handle."""
    if output_format == "json":
        json.dump(rows, handle, indent=2)
        handle.write("\n")
        return

    if output_format == "jsonl":
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True))
            handle.write("\n")
        return

    writer = csv.DictWriter(handle, fieldnames=_ENTRY_EXPORT_CSV_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow(_entry_export_csv_row(row))


def _entry_export_csv_row(row: dict[str, Any]) -> dict[str, str]:
    """Return a flat CSV row without dropping provenance fields."""
    return {
        "local_entry_id": str(row.get("local_entry_id") or ""),
        "run_id": str(row.get("run_id") or ""),
        "name": str(row.get("name") or ""),
        "entry_type": str(row.get("entry_type") or ""),
        "description": str(row.get("description") or ""),
        "city": str(row.get("city") or ""),
        "state": str(row.get("state") or ""),
        "score": f"{float(row.get('score') or 0.0):.6f}",
        "website": str(row.get("website") or ""),
        "email": str(row.get("email") or ""),
        "issue_areas": ";".join(_string_list(row.get("issue_areas"))),
        "source_urls": json.dumps(_string_list(row.get("source_urls")), sort_keys=True),
        "source_contexts": json.dumps(row.get("source_contexts") or {}, sort_keys=True),
        "source_context": str(row.get("source_context") or ""),
        "source_dataset": str(row.get("source_dataset") or ""),
        "source_key": str(row.get("source_key") or ""),
        "last_seen": str(row.get("last_seen") or ""),
        "source_dates": json.dumps(_string_list(row.get("source_dates")), sort_keys=True),
        "created_at": str(row.get("created_at") or ""),
    }


def _string_list(value: object) -> list[str]:
    """Return a list of strings from JSON-like row data."""
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]
