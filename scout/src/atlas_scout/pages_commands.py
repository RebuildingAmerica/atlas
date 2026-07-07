"""Page browsing commands for Scout."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click
from rich.table import Table

from atlas_scout.cli_context import console
from atlas_scout.cli_output import styled_status

if TYPE_CHECKING:
    from collections.abc import Coroutine

    from atlas_scout.config import ScoutConfig

__all__ = ["pages"]


def _run_async[AsyncResult](coro: Coroutine[Any, Any, AsyncResult]) -> AsyncResult:
    """Run an async page command through Scout's interrupt boundary."""
    try:
        return asyncio.run(coro)
    except KeyboardInterrupt as exc:
        raise click.Abort from exc


# ---------------------------------------------------------------------------
# pages commands
# ---------------------------------------------------------------------------


@click.group()
def pages() -> None:
    """Browse scraped pages."""


@pages.command("list")
@click.option("--limit", default=50, show_default=True)
@click.pass_context
def pages_list(ctx: click.Context, limit: int) -> None:
    """List all scraped pages with status."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_pages_list(config, limit))


async def _pages_list(config: ScoutConfig, limit: int) -> None:
    """Fetch and print page tracking data."""
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        console.print("[dim]No pages yet.[/]")
        return
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        tasks = await store.list_all_page_tasks(limit=limit)
        if not tasks:
            cached = await store.list_pages(limit=limit)
            if not cached:
                console.print("[dim]No pages yet.[/]")
                return
            table = Table(show_lines=False, pad_edge=False)
            table.add_column("Fetched", style="dim")
            table.add_column("Title")
            table.add_column("URL", style="dim")
            for p in cached:
                title = (p["metadata"].get("title") or "—")[:38]
                table.add_row(p["fetched_at"][:19], title, p["url"])
            console.print(table)
            return
    finally:
        await store.close()

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Status")
    table.add_column("Detail")
    table.add_column("URL", style="dim")
    for t in tasks:
        detail = ""
        if t["entries_extracted"]:
            detail = f"{t['entries_extracted']} entries"
        elif t.get("error"):
            detail = t["error"]
        table.add_row(styled_status(t["status"]), detail, t["url"])
    console.print(table)
