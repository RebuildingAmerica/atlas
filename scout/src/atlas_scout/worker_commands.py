"""Atlas worker commands for Scout."""

from __future__ import annotations

import click

from atlas_scout.cli_common import _exit_with_error, _run_async
from atlas_scout.cli_errors import CliError
from atlas_scout.worker import _worker_run_internal, _worker_start, _worker_status, _worker_stop


@click.group("worker")
def worker_group() -> None:
    """Manage the Atlas worker process."""


@worker_group.command("start")
@click.option("--atlas-url", default=None, help="Atlas app URL. Defaults to the saved login.")
@click.option(
    "--search-api-key",
    default=None,
    envvar="SEARCH_API_KEY",
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option("--interval", default=10, show_default=True, help="Idle poll interval in seconds.")
@click.option("--lease-seconds", default=900, show_default=True, help="Worker job lease seconds.")
@click.pass_context
def worker_start(
    ctx: click.Context,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Start this computer as an Atlas worker."""
    try:
        _run_async(
            _worker_start(
                ctx.obj["config"],
                config_path=ctx.obj["config_path"],
                debug=bool(ctx.obj.get("debug")),
                atlas_url=atlas_url,
                search_api_key=search_api_key,
                interval=interval,
                lease_seconds=lease_seconds,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


@worker_group.command("stop")
def worker_stop() -> None:
    """Stop the tracked Atlas worker process."""
    _run_async(_worker_stop())


@worker_group.command("status")
def worker_status() -> None:
    """Show the tracked Atlas worker state."""
    _worker_status()


@worker_group.command("run-internal", hidden=True)
@click.option("--atlas-url", default=None)
@click.option("--search-api-key", default=None, envvar="SEARCH_API_KEY")
@click.option("--interval", default=10)
@click.option("--lease-seconds", default=900)
@click.pass_context
def worker_run_internal(
    ctx: click.Context,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Run the foreground Atlas worker loop."""
    try:
        _run_async(
            _worker_run_internal(
                ctx.obj["config"],
                atlas_url=atlas_url,
                search_api_key=search_api_key,
                interval=interval,
                lease_seconds=lease_seconds,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))
