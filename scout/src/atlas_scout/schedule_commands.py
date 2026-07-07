"""Scheduled discovery commands for Scout."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click

from atlas_scout.auth_commands import _require_search_connection
from atlas_scout.cli_common import _run_async
from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

# ---------------------------------------------------------------------------
# schedule — Run discovery on configured schedule targets
# ---------------------------------------------------------------------------


@click.group()
def schedule() -> None:
    """Manage scheduled discovery runs."""


@schedule.command("run-once")
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.pass_context
def schedule_run_once(ctx: click.Context, search_api_key: str | None) -> None:
    """Run all configured schedule targets once."""
    config: ScoutConfig = ctx.obj["config"]
    if not config.schedule.targets:
        console.print("[yellow]No schedule targets configured.[/]")
        console.print("Add targets to your config under [schedule.targets].")
        return
    resolved_search_key = _require_search_connection(search_api_key)
    console.print(f"[bold]Running {len(config.schedule.targets)} targets...[/]")
    run_ids = _run_async(_schedule_run_once(config, resolved_search_key))
    console.print(f"\n[bold green]Completed {len(run_ids)} runs.[/]")
    for rid in run_ids:
        console.print(f"  {rid}")


async def _schedule_run_once(config: ScoutConfig, search_api_key: str) -> list[str]:
    from atlas_scout.scheduler import run_schedule_once

    return await run_schedule_once(config, search_api_key)


@schedule.command("start")
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option(
    "--interval", default=0, help="Override interval in seconds (0 = use cron from config)"
)
@click.pass_context
def schedule_start(ctx: click.Context, search_api_key: str | None, interval: int) -> None:
    """Start the scheduler loop (runs until interrupted)."""
    config: ScoutConfig = ctx.obj["config"]
    if not config.schedule.targets:
        console.print("[yellow]No schedule targets configured.[/]")
        return
    resolved_search_key = _require_search_connection(search_api_key)
    console.print(f"[bold]Starting scheduler with {len(config.schedule.targets)} targets...[/]")
    console.print("Press Ctrl+C to stop.\n")
    _run_async(_schedule_start(config, resolved_search_key, interval))


async def _schedule_start(config: ScoutConfig, search_api_key: str, interval: int) -> None:
    from atlas_scout.scheduler import run_schedule_loop

    await run_schedule_loop(config, search_api_key, interval_seconds=interval)
