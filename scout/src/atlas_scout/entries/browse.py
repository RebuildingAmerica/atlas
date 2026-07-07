"""Entry listing/browsing for Scout."""

from __future__ import annotations

import csv
import io
import json
from typing import TYPE_CHECKING

import click
from rich.table import Table

from atlas_scout.cli_context import console
from atlas_scout.entries.query import (
    _dedupe_entries_by_name,
    _load_entries,
    _select_entries_for_output,
)

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


async def _entries_list(
    config: ScoutConfig,
    min_score: float,
    entry_type: str | None,
    limit: int,
    output_format: str,
    *,
    run_ids: tuple[str, ...] = (),
    random_sample: bool = False,
    unique_names: bool = False,
) -> None:
    """Fetch and display entries in the requested format."""
    try:
        all_entries = await _load_entries(config, min_score=min_score, run_ids=run_ids)
    except FileNotFoundError:
        console.print("[dim]No entries yet. Run 'scout run' first.[/]")
        return

    if entry_type:
        all_entries = [e for e in all_entries if e["entry_type"] == entry_type]
    if unique_names:
        all_entries = _dedupe_entries_by_name(all_entries)
    shown = _select_entries_for_output(
        all_entries,
        limit=limit,
        random_sample=random_sample,
        unlimited_when_zero=False,
    )
    if not shown:
        if output_format == "json":
            click.echo("[]")
        elif output_format != "csv":
            console.print("[dim]No entries found.[/]")
        return

    if output_format == "json":
        rows = [
            {
                "run_id": e.get("run_id"),
                "name": e["name"],
                "entry_type": e["entry_type"],
                "description": e.get("description", ""),
                "city": e.get("city"),
                "state": e.get("state"),
                "score": e["score"],
                "website": e.get("data", {}).get("website"),
                "email": e.get("data", {}).get("email"),
                "issue_areas": e.get("data", {}).get("issue_areas", []),
                "source_urls": e.get("data", {}).get("source_urls", []),
                "source_contexts": e.get("data", {}).get("source_contexts", {}),
                "source_context": e.get("data", {}).get("source_context"),
                "source_dataset": e.get("data", {}).get("source_dataset"),
            }
            for e in shown
        ]
        click.echo(json.dumps(rows, indent=2))
        return

    if output_format == "csv":
        fields = [
            "name",
            "entry_type",
            "description",
            "city",
            "state",
            "score",
            "website",
            "email",
            "issue_areas",
        ]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields)
        writer.writeheader()
        for e in shown:
            data = e.get("data", {})
            writer.writerow(
                {
                    "name": e["name"],
                    "entry_type": e["entry_type"],
                    "description": e.get("description", ""),
                    "city": e.get("city") or "",
                    "state": e.get("state") or "",
                    "score": f"{e['score']:.2f}",
                    "website": data.get("website") or "",
                    "email": data.get("email") or "",
                    "issue_areas": ";".join(data.get("issue_areas", [])),
                }
            )
        click.echo(buf.getvalue(), nl=False)
        return

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Score", style="bold", width=6, justify="right")
    table.add_column("Type", style="dim")
    table.add_column("Name")
    table.add_column("Location")
    for e in shown:
        table.add_row(
            f"{e['score']:.2f}",
            e["entry_type"],
            e["name"],
            f"{e.get('city') or '?'}, {e.get('state') or '?'}",
        )
    console.print(table)
    if len(all_entries) > limit:
        console.print(f"\n[dim]... and {len(all_entries) - limit} more (--limit to show more)[/]")
