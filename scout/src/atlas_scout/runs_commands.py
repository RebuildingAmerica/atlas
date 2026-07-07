"""Run history and sync commands for Scout."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click

from atlas_scout.cli_common import _run_async
from atlas_scout.runs import (
    _resolve_sync_run_ids,
    _runs_cancel,
    _runs_inspect,
    _runs_list,
    _runs_sync,
    _should_sync_after_run,
    _sync_runs,
)

if TYPE_CHECKING:
    from atlas_scout.auth import UploadTarget
    from atlas_scout.config import ScoutConfig

__all__ = [
    "_resolve_sync_run_ids",
    "_runs_inspect",
    "_runs_list",
    "_runs_sync",
    "_should_sync_after_run",
    "_sync_runs",
    "runs",
    "sync",
]

# ---------------------------------------------------------------------------
# sync command
# ---------------------------------------------------------------------------


@click.command("sync")
@click.argument("run_ids", nargs=-1)
@click.option("--all-ready", is_flag=True, help="Sync every completed run with ready artifacts.")
@click.option("--atlas-url", default=None, help="Override the Atlas base URL for sync.")
@click.option("--api-key", default=None, envvar="ATLAS_API_KEY", help="Override the Atlas API key.")
@click.option(
    "--target",
    type=click.Choice(["public", "workspace"]),
    default=None,
    help="Upload destination for logged-in Scout syncs.",
)
@click.option("--workspace", default=None, help="Workspace id for workspace-private sync.")
@click.pass_context
def sync(
    ctx: click.Context,
    run_ids: tuple[str, ...],
    all_ready: bool,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync the latest, selected, or all ready local runs to Atlas."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _sync_runs(
            config,
            run_ids,
            all_ready=all_ready,
            atlas_url=atlas_url,
            api_key=api_key,
            target=target,
            workspace=workspace,
        )
    )


# ---------------------------------------------------------------------------
# runs commands
# ---------------------------------------------------------------------------


@click.group()
def runs() -> None:
    """Manage discovery runs."""


@runs.command("list")
@click.option("--limit", default=20, show_default=True)
@click.pass_context
def runs_list(ctx: click.Context, limit: int) -> None:
    """List recent discovery runs."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_list(config, limit))


@runs.command("inspect")
@click.argument("run_id")
@click.pass_context
def runs_inspect(ctx: click.Context, run_id: str) -> None:
    """Show details of a specific run."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_inspect(config, run_id))


@runs.command("cancel")
@click.argument("run_id")
@click.pass_context
def runs_cancel(ctx: click.Context, run_id: str) -> None:
    """Mark a local run record as cancelled."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_cancel(config, run_id))


@runs.command("sync")
@click.argument("run_id")
@click.option("--atlas-url", default=None, help="Override the Atlas base URL for sync.")
@click.option("--api-key", default=None, envvar="ATLAS_API_KEY", help="Override the Atlas API key.")
@click.option(
    "--target",
    type=click.Choice(["public", "workspace"]),
    default=None,
    help="Upload destination for logged-in Scout syncs.",
)
@click.option("--workspace", default=None, help="Workspace id for workspace-private sync.")
@click.pass_context
def runs_sync(
    ctx: click.Context,
    run_id: str,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync a completed local run to Atlas."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _runs_sync(
            config,
            run_id,
            atlas_url=atlas_url,
            api_key=api_key,
            target=target,
            workspace=workspace,
        )
    )
