"""Active-entry purge by source dataset for Scout."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

import click
from rich.table import Table

from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


async def entries_purge_command(
    config: ScoutConfig,
    *,
    source_dataset: str,
    yes: bool,
    dry_run: bool,
    json_output: bool,
) -> None:
    """Count or delete active entries tagged with a source dataset."""
    if not dry_run and not yes:
        raise click.ClickException(
            "Refusing to purge entries without --yes. Use --dry-run to inspect the count."
        )

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        payload = {
            "source_dataset": source_dataset,
            "matched": 0,
            "deleted": 0,
            "dry_run": dry_run,
        }
        _print_purge_payload(payload, json_output=json_output)
        return

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        matched = await store.count_entries_by_source_dataset(source_dataset)
        deleted = 0 if dry_run else await store.purge_entries_by_source_dataset(source_dataset)
    finally:
        await store.close()

    payload = {
        "source_dataset": source_dataset,
        "matched": matched,
        "deleted": deleted,
        "dry_run": dry_run,
    }
    _print_purge_payload(payload, json_output=json_output)


def _print_purge_payload(payload: dict[str, object], *, json_output: bool) -> None:
    """Print purge output as JSON or a compact table."""
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    for key, value in payload.items():
        table.add_row(key.replace("_", " "), str(value))
    console.print(table)
