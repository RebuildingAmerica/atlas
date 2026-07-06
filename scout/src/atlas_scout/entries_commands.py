"""Source-neutral entry command helpers for Scout."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click
from rich.table import Table

from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

__all__ = ["entries_purge_command", "entries_stats_command"]


async def entries_stats_command(
    config: ScoutConfig,
    json_output: bool,
    required_types: tuple[str, ...],
    min_source_backed: int | None,
    *,
    run_id: str | None = None,
    excluded_source_datasets: tuple[str, ...] = (),
    min_people: int | None = None,
) -> None:
    """Fetch and display source-neutral entry statistics."""
    stats = await _load_entry_stats(
        config,
        run_id=run_id,
        excluded_source_datasets=set(excluded_source_datasets),
    )
    by_type = stats["by_type"]
    if isinstance(by_type, dict):
        missing_types = [
            entry_type for entry_type in required_types if by_type.get(entry_type, 0) <= 0
        ]
        people_count = by_type.get("person", 0)
    else:
        missing_types = list(required_types)
        people_count = 0
    if missing_types:
        raise click.ClickException(f"Missing required entry type(s): {', '.join(missing_types)}")

    source_backed_value = stats.get("source_backed_entries", 0)
    source_backed_entries = source_backed_value if isinstance(source_backed_value, int) else 0
    if min_source_backed is not None and source_backed_entries < min_source_backed:
        raise click.ClickException(
            f"Only {source_backed_entries} source-backed entries; expected at least "
            f"{min_source_backed}."
        )

    if min_people is not None and people_count < min_people:
        raise click.ClickException(f"Only {people_count} people; expected at least {min_people}.")

    if json_output:
        click.echo(json.dumps(stats, sort_keys=True))
        return

    table = Table(title="Entry stats", show_lines=False, pad_edge=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    table.add_row("Total entries", str(stats["total_entries"]))
    table.add_row("People", str(people_count))
    table.add_row("Source-backed entries", str(source_backed_entries))
    table.add_row("Contextual people", str(stats["contextual_person_count"]))
    table.add_row("Source URLs", str(stats["source_url_count"]))
    table.add_row("Source domains", str(stats["source_domain_count"]))
    table.add_row("By type", json.dumps(stats["by_type"], sort_keys=True))
    table.add_row("By source dataset", json.dumps(stats["by_source_dataset"], sort_keys=True))
    table.add_row("By metro", json.dumps(stats["by_metro"], sort_keys=True))
    console.print(table)


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


async def _load_entry_stats(
    config: ScoutConfig,
    *,
    run_id: str | None,
    excluded_source_datasets: set[str],
) -> dict[str, Any]:
    """Load entry stats or return an empty shape when no local store exists."""
    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        return _empty_entry_stats()

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        return await store.entry_stats(
            run_id=run_id,
            excluded_source_datasets=excluded_source_datasets,
        )
    finally:
        await store.close()


def _empty_entry_stats() -> dict[str, Any]:
    """Return the stats shape for an empty or missing local store."""
    return {
        "total_entries": 0,
        "by_type": {},
        "source_backed_entries": 0,
        "by_source_dataset": {},
        "by_metro": {},
        "by_run": {},
        "contextual_person_count": 0,
        "source_url_count": 0,
        "source_domain_count": 0,
        "duplicate_source_keys": {},
    }


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
