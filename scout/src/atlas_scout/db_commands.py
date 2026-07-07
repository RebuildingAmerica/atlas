"""Local Scout database commands."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import click

from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

# ---------------------------------------------------------------------------
# db commands
# ---------------------------------------------------------------------------


@click.group()
def db() -> None:
    """Manage the local Scout database."""


@db.command("reset")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation.")
@click.pass_context
def db_reset(ctx: click.Context, yes: bool) -> None:
    """Delete all local data (runs, entries, pages)."""
    config: ScoutConfig = ctx.obj["config"]
    db_path = Path(config.store.path).expanduser()
    if not yes and not click.confirm("Delete all Scout data?"):
        console.print("[dim]Cancelled.[/]")
        return
    if db_path.exists():
        db_path.unlink()
        console.print(f"  [red]Deleted[/] {db_path}")
    console.print("[green]Database reset.[/]")


@db.command("path")
@click.pass_context
def db_path_cmd(ctx: click.Context) -> None:
    """Print the database file path."""
    config: ScoutConfig = ctx.obj["config"]
    console.print(Path(config.store.path).expanduser())
