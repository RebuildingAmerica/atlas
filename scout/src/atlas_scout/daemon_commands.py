"""Local scheduler daemon commands for Scout."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click

from atlas_scout.auth_commands import _require_search_connection
from atlas_scout.cli_common import _exit_with_error, _run_async
from atlas_scout.cli_errors import CliError
from atlas_scout.daemon import _daemon_run_internal, _daemon_start, _daemon_status, _daemon_stop

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


@click.group()
def daemon() -> None:
    """Manage the local Scout daemon."""


@daemon.command("start")
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
def daemon_start(ctx: click.Context, search_api_key: str | None, interval: int) -> None:
    """Start the scheduler as a local background daemon."""
    config: ScoutConfig = ctx.obj["config"]
    resolved_search_key = (
        _require_search_connection(search_api_key) if config.schedule.targets else ""
    )
    try:
        _run_async(
            _daemon_start(
                config,
                config_path=ctx.obj["config_path"],
                profile_name=ctx.obj.get("profile_name"),
                debug=bool(ctx.obj.get("debug")),
                search_api_key=resolved_search_key,
                interval=interval,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


@daemon.command("stop")
@click.pass_context
def daemon_stop(ctx: click.Context) -> None:
    """Stop the tracked local background daemon process."""
    config: ScoutConfig = ctx.obj["config"]
    try:
        _run_async(_daemon_stop(config))
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


@daemon.command("status")
@click.pass_context
def daemon_status(ctx: click.Context) -> None:
    """Show the tracked local daemon lifecycle state."""
    _run_async(_daemon_status(ctx.obj["config"]))


@daemon.command("run-internal", hidden=True)
@click.option("--search-api-key", envvar="SEARCH_API_KEY", required=True)
@click.option(
    "--interval", default=0, help="Override interval in seconds (0 = use cron from config)"
)
@click.pass_context
def daemon_run_internal(ctx: click.Context, search_api_key: str, interval: int) -> None:
    """Run the hidden daemon scheduler loop."""
    try:
        _run_async(
            _daemon_run_internal(
                ctx.obj["config"],
                config_path=ctx.obj["config_path"],
                profile_name=ctx.obj.get("profile_name"),
                search_api_key=search_api_key,
                interval=interval,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))
