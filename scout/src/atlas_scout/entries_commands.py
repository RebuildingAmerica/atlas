"""Entry browsing, export, stats, and purge commands for Scout."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import click

from atlas_scout.cli_common import _run_async
from atlas_scout.entries import (
    _entries_list,
    _export_entries,
    entries_purge_command,
    entries_stats_command,
)

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

__all__ = ["entries", "entries_purge_command", "entries_stats_command", "export_group"]


@click.group("export")
def export_group() -> None:
    """Export local Scout artifacts."""


@export_group.command("entries")
@click.option("--min-score", default=0.0, type=float)
@click.option("--type", "entry_type", default=None)
@click.option(
    "--limit",
    default=0,
    type=click.IntRange(0),
    show_default=True,
    help="Maximum rows to export. Use 0 for all matching rows.",
)
@click.option(
    "--run-id",
    "run_ids",
    multiple=True,
    help="Restrict entries to one or more local runs. Repeat to combine reviewed runs.",
)
@click.option("--random", "random_sample", is_flag=True, help="Return a random sample.")
@click.option(
    "--unique-names",
    is_flag=True,
    help="Return at most one entry per normalized name, type, city, and state.",
)
@click.option(
    "--format",
    "-o",
    "output_format",
    type=click.Choice(["jsonl", "json", "csv"]),
    default="jsonl",
    show_default=True,
)
@click.option(
    "--output",
    type=click.Path(dir_okay=False, path_type=Path),
    default=None,
    help="Write to a file instead of stdout.",
)
@click.pass_context
def export_entries(
    ctx: click.Context,
    min_score: float,
    entry_type: str | None,
    limit: int,
    run_ids: tuple[str, ...],
    random_sample: bool,
    unique_names: bool,
    output_format: str,
    output: Path | None,
) -> None:
    """Export discovered entries with source provenance."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _export_entries(
            config,
            min_score,
            entry_type,
            limit,
            output_format,
            output,
            run_ids=run_ids,
            random_sample=random_sample,
            unique_names=unique_names,
        )
    )


@click.group()
def entries() -> None:
    """Browse discovered entries."""


@entries.command("stats")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.option(
    "--require-type",
    "required_types",
    multiple=True,
    help="Fail unless this entry type exists. Repeat for multiple types.",
)
@click.option(
    "--min-source-backed",
    type=click.IntRange(0),
    default=None,
    help="Fail unless at least this many entries have source provenance.",
)
@click.option("--run-id", default=None, help="Restrict stats to one local run.")
@click.option(
    "--exclude-source-dataset",
    "excluded_source_datasets",
    multiple=True,
    help="Ignore entries tagged with this source_dataset. Repeat for multiple datasets.",
)
@click.option(
    "--min-people",
    type=click.IntRange(0),
    default=None,
    help="Fail unless at least this many person entries remain after filters.",
)
@click.option(
    "--min-unique-people",
    type=click.IntRange(0),
    default=None,
    help="Fail unless at least this many exact unique person keys remain after filters.",
)
@click.pass_context
def entries_stats(
    ctx: click.Context,
    json_output: bool,
    required_types: tuple[str, ...],
    min_source_backed: int | None,
    run_id: str | None,
    excluded_source_datasets: tuple[str, ...],
    min_people: int | None,
    min_unique_people: int | None,
) -> None:
    """Show aggregate entry counts for discovery verification."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        entries_stats_command(
            config,
            json_output,
            required_types,
            min_source_backed,
            run_id=run_id,
            excluded_source_datasets=excluded_source_datasets,
            min_people=min_people,
            min_unique_people=min_unique_people,
        )
    )


@entries.command("purge")
@click.option("--source-dataset", required=True, help="Delete entries tagged with this dataset.")
@click.option("--yes", is_flag=True, help="Confirm deletion.")
@click.option("--dry-run", is_flag=True, help="Count matching entries without deleting them.")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def entries_purge(
    ctx: click.Context,
    source_dataset: str,
    yes: bool,
    dry_run: bool,
    json_output: bool,
) -> None:
    """Delete active entries matching a source dataset marker."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        entries_purge_command(
            config,
            source_dataset=source_dataset,
            yes=yes,
            dry_run=dry_run,
            json_output=json_output,
        )
    )


@entries.command("list")
@click.option("--min-score", default=0.0, type=float)
@click.option("--type", "entry_type", default=None)
@click.option("--limit", default=50, show_default=True)
@click.option(
    "--run-id",
    "run_ids",
    multiple=True,
    help="Restrict entries to one or more local runs. Repeat to combine reviewed runs.",
)
@click.option("--random", "random_sample", is_flag=True, help="Return a random sample.")
@click.option(
    "--unique-names",
    is_flag=True,
    help="Return at most one entry per normalized name, type, city, and state.",
)
@click.option(
    "--format", "-o", "output_format", type=click.Choice(["table", "json", "csv"]), default="table"
)
@click.pass_context
def entries_list(
    ctx: click.Context,
    min_score: float,
    entry_type: str | None,
    limit: int,
    run_ids: tuple[str, ...],
    random_sample: bool,
    unique_names: bool,
    output_format: str,
) -> None:
    """List all discovered entries."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _entries_list(
            config,
            min_score,
            entry_type,
            limit,
            output_format,
            run_ids=run_ids,
            random_sample=random_sample,
            unique_names=unique_names,
        )
    )
