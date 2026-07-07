"""Run listing, inspection, and cancellation for Scout."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

from rich.table import Table

from atlas_scout.cli_context import console, err_console
from atlas_scout.cli_output import styled_status

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

_TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled"}


async def _runs_list(config: ScoutConfig, limit: int) -> None:
    """Fetch and print recent runs."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        records = await store.list_runs(limit=limit)
    finally:
        await store.close()
    if not records:
        console.print("[dim]No runs found.[/]")
        return
    table = Table(show_lines=False, pad_edge=False)
    table.add_column("ID", style="bold")
    table.add_column("Status")
    table.add_column("Location")
    table.add_column("Entries", justify="right")
    table.add_column("Created", style="dim")
    for r in records:
        table.add_row(
            r["id"],
            styled_status(r["status"]),
            r["location"] or "—",
            str(r.get("entries_found") or 0),
            r["created_at"][:19],
        )
    console.print(table)


async def _runs_inspect(config: ScoutConfig, run_id: str) -> None:
    """Print detailed run information."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            rec = await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)
        artifacts = await store.get_run_artifacts(run_id)
        entries = await store.list_entries(run_id=run_id)
        page_tasks = await store.list_page_tasks(run_id)
    finally:
        await store.close()

    console.print(f"[bold]Run {rec['id']}[/]")
    console.print(f"  Status: {styled_status(rec['status'])}")
    if rec["location"]:
        console.print(f"  Location: {rec['location']}")
    console.print(f"  Created: [dim]{rec['created_at'][:19]}[/]")
    if rec.get("completed_at"):
        console.print(f"  Completed: [dim]{rec['completed_at'][:19]}[/]")
    if rec.get("error"):
        console.print(f"  Error: [red]{rec['error']}[/]")
    if artifacts and artifacts.manifest.sync:
        sync = artifacts.manifest.sync
        console.print(f"  Sync: {sync.sync_status or 'pending'}")
        if sync.remote_run_id:
            console.print(f"  Remote run: [dim]{sync.remote_run_id}[/]")
        if sync.last_error:
            console.print(f"  Sync error: [red]{sync.last_error}[/]")

    if page_tasks:
        console.print()
        pt_table = Table(title=f"Pages ({len(page_tasks)})", show_lines=False, pad_edge=False)
        pt_table.add_column("Status")
        pt_table.add_column("Detail")
        pt_table.add_column("URL", style="dim")
        for pt in page_tasks:
            detail = ""
            if pt.get("entries_extracted"):
                detail = f"{pt['entries_extracted']} entries"
            elif pt.get("error"):
                detail = pt["error"]
            pt_table.add_row(styled_status(pt["status"]), detail, pt["url"])
        console.print(pt_table)

    if entries:
        console.print()
        for e in entries:
            console.print(
                f"  [{e['score']:.2f}] {e['name']} ({e['entry_type']}) — {e.get('city')}, {e.get('state')}"
            )
    else:
        console.print("\n[dim]No entries.[/]")


async def _runs_cancel(config: ScoutConfig, run_id: str) -> None:
    """Cancel a non-terminal local run record without interrupting active work."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            record = await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)

        status = str(record["status"])
        if status in _TERMINAL_RUN_STATUSES:
            err_console.print(
                f"[yellow]Run already {status}:[/] {run_id}. "
                "scout runs cancel only updates local Scout run records and does not "
                "interrupt active work."
            )
            sys.exit(1)

        await store.cancel_run(
            run_id,
            error="Cancelled locally via CLI; active work is not interrupted.",
        )
    finally:
        await store.close()

    console.print(
        f"[green]Cancelled local run[/] {run_id}. "
        "This updates Scout's local run record only and does not interrupt active work."
    )
