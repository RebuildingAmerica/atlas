"""Entry browsing, export, stats, and purge commands for Scout."""

from __future__ import annotations

import csv
import io
import json
import random
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click
from rich.table import Table

from atlas_scout.cli_common import _run_async
from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

__all__ = ["entries", "entries_purge_command", "entries_stats_command", "export_group"]


async def entries_stats_command(
    config: ScoutConfig,
    json_output: bool,
    required_types: tuple[str, ...],
    min_source_backed: int | None,
    *,
    run_id: str | None = None,
    excluded_source_datasets: tuple[str, ...] = (),
    min_people: int | None = None,
    min_unique_people: int | None = None,
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

    unique_people_value = stats.get("unique_person_keys", 0)
    unique_people_count = unique_people_value if isinstance(unique_people_value, int) else 0
    if min_unique_people is not None and unique_people_count < min_unique_people:
        raise click.ClickException(
            f"Only {unique_people_count} exact unique people; expected at least "
            f"{min_unique_people}."
        )

    if json_output:
        click.echo(json.dumps(stats, sort_keys=True))
        return

    table = Table(title="Entry stats", show_lines=False, pad_edge=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    table.add_row("Total entries", str(stats["total_entries"]))
    table.add_row("People", str(people_count))
    table.add_row("Exact unique people", str(unique_people_count))
    table.add_row("Source-backed entries", str(source_backed_entries))
    table.add_row("Contextual people", str(stats["contextual_person_count"]))
    table.add_row("Exact duplicate groups", str(stats["exact_duplicate_groups"]))
    table.add_row("Exact duplicate surplus", str(stats["exact_duplicate_surplus"]))
    table.add_row("Source URLs", str(stats["source_url_count"]))
    table.add_row("Source domains", str(stats["source_domain_count"]))
    table.add_row("By type", json.dumps(stats["by_type"], sort_keys=True))
    table.add_row("By source dataset", json.dumps(stats["by_source_dataset"], sort_keys=True))
    table.add_row("By location", json.dumps(stats["by_location"], sort_keys=True))
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
        "by_location": {},
        "by_metro": {},
        "by_run": {},
        "contextual_person_count": 0,
        "source_url_count": 0,
        "source_domain_count": 0,
        "duplicate_source_keys": {},
        "exact_duplicate_groups": 0,
        "exact_duplicate_surplus": 0,
        "unique_person_keys": 0,
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


# ---------------------------------------------------------------------------
# entries commands
# ---------------------------------------------------------------------------

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


async def _load_entries(
    config: ScoutConfig,
    *,
    min_score: float,
    run_ids: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Load local entries for review or export."""
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        raise FileNotFoundError(db_path)

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        if run_ids:
            entries: list[dict[str, Any]] = []
            for run_id in run_ids:
                entries.extend(await store.list_entries(run_id=run_id, min_score=min_score))
            return entries
        return await store.list_entries(min_score=min_score)
    finally:
        await store.close()


def _select_entries_for_output(
    entries: list[dict[str, Any]],
    *,
    limit: int,
    random_sample: bool,
    unlimited_when_zero: bool,
) -> list[dict[str, Any]]:
    """Apply output limits and optional random sampling."""
    normalized_limit = max(0, limit)
    if unlimited_when_zero and normalized_limit == 0:
        normalized_limit = len(entries)
    if random_sample:
        return random.sample(entries, min(normalized_limit, len(entries)))
    return entries[:normalized_limit]


def _dedupe_entries_by_name(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    """Return one entry per normalized name/type/location, preferring higher scores."""
    best_by_key: dict[tuple[str, str, str, str], dict[str, object]] = {}
    ordered_keys: list[tuple[str, str, str, str]] = []
    for entry in entries:
        key = (
            str(entry.get("name", "")).strip().casefold(),
            str(entry.get("entry_type", "")).strip().casefold(),
            str(entry.get("city") or "").strip().casefold(),
            str(entry.get("state") or "").strip().casefold(),
        )
        if key[0] == "":
            continue
        existing = best_by_key.get(key)
        if existing is None:
            ordered_keys.append(key)
            best_by_key[key] = entry
            continue
        if _entry_score(entry) > _entry_score(existing):
            best_by_key[key] = entry
    return [best_by_key[key] for key in ordered_keys]


def _entry_score(entry: dict[str, object]) -> float:
    """Return an entry score as a sortable float."""
    score = entry.get("score", 0.0)
    return float(score) if isinstance(score, (int, float)) else 0.0


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
