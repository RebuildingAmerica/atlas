"""Run history and sync commands for Scout."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

import click
from rich.table import Table

from atlas_scout.auth import DeviceAuthClient, UploadTarget, load_session
from atlas_scout.auth_commands import (
    _default_worker_name,
    _load_session_or_exit,
    _search_key_configured,
)
from atlas_scout.cli_common import (
    ScoutSyncError,
    _exit_with_error,
    _print_credential_store_error,
    _run_async,
)
from atlas_scout.cli_context import console, err_console
from atlas_scout.cli_errors import CliError
from atlas_scout.cli_output import styled_status
from atlas_scout.credentials import CredentialStoreError

if TYPE_CHECKING:
    from atlas_shared import SyncedEntryLink

    from atlas_scout.config import ScoutConfig
    from atlas_scout.steps.contribute import ContributionResult


def _atlas_url_for_path(atlas_url: str, path: str) -> str:
    """Join an Atlas base URL and relative app path."""
    if path.startswith(("http://", "https://")):
        return path
    return f"{atlas_url.rstrip('/')}/{path.lstrip('/')}"


def _sync_visibility_label(link: SyncedEntryLink) -> str:
    """Return a compact human label for a synced entry receipt."""
    if link.visibility == "public":
        return "public profile"
    if link.visibility == "existing_shared":
        return "existing public profile"
    if link.visibility == "workspace_private":
        return "workspace private"
    return "held for review"


def _print_sync_receipt(
    *,
    local_run_id: str,
    atlas_url: str,
    result: ContributionResult,
) -> None:
    """Print a developer-facing receipt for a completed run sync."""
    message = "Already synced" if result.duplicate else "Synced"
    console.print(f"[green]{message}[/] run {local_run_id} -> [bold]{result.run_id}[/]")
    if result.run_id:
        console.print(
            f"Open run: {_atlas_url_for_path(atlas_url, f'/discovery?run={result.run_id}')}"
        )

    if not result.entry_links:
        return

    console.print("Entries:")
    for link in result.entry_links[:10]:
        entry_url = _atlas_url_for_path(atlas_url, link.url) if link.url else None
        suffix = f" - {entry_url}" if entry_url else ""
        console.print(f"  {link.name} - {_sync_visibility_label(link)}{suffix}")
    remaining = len(result.entry_links) - 10
    if remaining > 0:
        console.print(f"  +{remaining} more")


def _should_sync_after_run(
    config: ScoutConfig,
    *,
    result_artifacts_available: bool,
    sync_after_run: bool | None,
) -> bool:
    """Return whether a completed run should be synced automatically."""
    if sync_after_run is False:
        return False
    if not result_artifacts_available:
        if sync_after_run is True:
            err_console.print(
                "[yellow]Sync skipped:[/] this run did not produce canonical Atlas artifacts."
            )
        return False
    if sync_after_run is True:
        return True
    if config.contribution.enabled:
        return False
    try:
        return load_session() is not None
    except CredentialStoreError as exc:
        _print_credential_store_error(exc)
        return False


# ---------------------------------------------------------------------------
# Root group
# ---------------------------------------------------------------------------

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


async def _resolve_sync_run_ids(
    config: ScoutConfig,
    *,
    run_ids: tuple[str, ...],
    all_ready: bool,
) -> list[str]:
    """Resolve top-level sync selectors into concrete local run IDs."""
    if all_ready and run_ids:
        raise ScoutSyncError("Use either explicit run ids or --all-ready, not both.")
    if run_ids and run_ids != ("latest",) and not all_ready:
        return list(run_ids)

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        limit = None if all_ready else 1
        resolved = await store.list_syncable_run_ids(limit=limit)
    finally:
        await store.close()

    if not resolved:
        raise ScoutSyncError("No completed runs with ready artifacts.")
    return resolved


async def _sync_runs(
    config: ScoutConfig,
    run_ids: tuple[str, ...],
    *,
    all_ready: bool,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync one or more local runs to Atlas."""
    try:
        resolved_run_ids = await _resolve_sync_run_ids(
            config,
            run_ids=run_ids,
            all_ready=all_ready,
        )
        for run_id in resolved_run_ids:
            await _runs_sync(
                config,
                run_id,
                atlas_url=atlas_url,
                api_key=api_key,
                target=target,
                workspace=workspace,
            )
    except ScoutSyncError as exc:
        _exit_with_error(CliError(title="Sync failed", message=str(exc)))


# ---------------------------------------------------------------------------
# runs commands
# ---------------------------------------------------------------------------

_TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled"}


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


@runs.command("inspect")
@click.argument("run_id")
@click.pass_context
def runs_inspect(ctx: click.Context, run_id: str) -> None:
    """Show details of a specific run."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_inspect(config, run_id))


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


@runs.command("cancel")
@click.argument("run_id")
@click.pass_context
def runs_cancel(ctx: click.Context, run_id: str) -> None:
    """Mark a local run record as cancelled."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_cancel(config, run_id))


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


async def _runs_sync(
    config: ScoutConfig,
    run_id: str,
    *,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None = None,
    workspace: str | None = None,
) -> None:
    """Load a local run bundle and sync it to Atlas."""
    from atlas_scout.steps.contribute import sync_run_artifacts
    from atlas_scout.store import ScoutStore

    session = None
    resolved_api_key = api_key or config.contribution.api_key
    if not resolved_api_key:
        session = _load_session_or_exit()

    resolved_atlas_url = atlas_url or config.contribution.atlas_url
    if session is not None:
        resolved_atlas_url = atlas_url or session.atlas_url or config.contribution.atlas_url

    if not resolved_atlas_url:
        err_console.print(
            "[red]Atlas URL required:[/] set contribution.atlas_url or pass --atlas-url."
        )
        sys.exit(1)
    if not resolved_api_key and session is None:
        err_console.print(
            "[red]Authentication required:[/] Log in with `scout login` or pass --api-key."
        )
        sys.exit(1)

    resolved_target = target or (session.default_upload_target if session else None)
    resolved_workspace = workspace or (session.workspace_id if session else None)
    if session is not None and resolved_target is None:
        resolved_target = "public"
    if resolved_target == "public":
        resolved_workspace = None
    if session is not None and resolved_target == "workspace" and not resolved_workspace:
        err_console.print(
            "[red]Workspace required:[/] pass --workspace for workspace-private sync."
        )
        sys.exit(1)

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)

        artifacts = await store.get_run_artifacts(run_id)
        if artifacts is None:
            err_console.print(f"[red]Run artifacts missing:[/] {run_id}")
            sys.exit(1)

        await store.update_run_sync(run_id, sync_status="syncing")
        if session is not None:
            if resolved_target is None:
                raise ScoutSyncError("Upload target was not resolved for logged-in sync.")
            session_target: UploadTarget = resolved_target
            token_exchange = await DeviceAuthClient().exchange_session_for_api_token(
                resolved_atlas_url,
                session_token=session.access_token,
                worker_id=session.worker_id,
                worker_name=session.worker_name or _default_worker_name(),
                default_upload_target=session_target,
                workspace_id=resolved_workspace,
                search_key_configured=_search_key_configured(),
            )
            result = await sync_run_artifacts(
                artifacts,
                atlas_url=resolved_atlas_url,
                api_key="",
                bearer_token=token_exchange.token,
                target=resolved_target,
                workspace_id=resolved_workspace,
            )
        else:
            result = await sync_run_artifacts(
                artifacts,
                atlas_url=resolved_atlas_url,
                api_key=resolved_api_key,
            )
        if result.errors:
            sync_error = "; ".join(result.errors)
            await store.update_run_sync(
                run_id,
                sync_status="failed",
                last_error=sync_error,
            )
            _exit_with_error(CliError(title="Sync failed", message=sync_error))

        await store.update_run_sync(
            run_id,
            sync_status=result.sync_status or "synced",
            remote_run_id=result.run_id,
        )
    finally:
        await store.close()

    _print_sync_receipt(
        local_run_id=run_id,
        atlas_url=resolved_atlas_url,
        result=result,
    )
