"""Start/stop/status orchestration for Scout's local scheduler daemon."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import TYPE_CHECKING

import click

from atlas_scout.cli_context import console
from atlas_scout.daemon.formatting import _render_recent_run_summary, _render_recent_tick_summary
from atlas_scout.daemon.process import (
    _daemon_process_is_running,
    _install_daemon_signal_handlers,
    _signal_daemon_process,
    _spawn_daemon_process,
)
from atlas_scout.daemon.state import (
    _clear_failed_daemon_start,
    _daemon_interval_metadata,
    _daemon_start_claim_is_stale,
    _daemon_start_conflict_message,
    _open_store,
    _require_schedule_targets,
    _wait_for_daemon_start,
    _wait_for_daemon_stop,
)

if TYPE_CHECKING:
    import subprocess
    from pathlib import Path

    from atlas_scout.config import ScoutConfig


async def _daemon_start(
    config: ScoutConfig,
    *,
    config_path: Path,
    profile_name: str | None,
    debug: bool,
    search_api_key: str,
    interval: int,
) -> None:
    """Start the local Scout daemon if one is not already active."""
    target_count = _require_schedule_targets(config)
    interval_seconds, interval_basis = _daemon_interval_metadata(config, interval=interval)
    store = await _open_store(config)
    try:
        daemon_state = await store.get_daemon_state()
        tracked_pid = daemon_state.get("process_id")
        if daemon_state["status"] == "starting":
            if not _daemon_start_claim_is_stale(daemon_state):
                raise click.ClickException(
                    "Scout daemon is already being started by another process."
                )
            console.print("[yellow]Cleared stale daemon start state before restart.[/]")
        if (
            daemon_state["status"] == "running"
            and isinstance(tracked_pid, int)
            and _daemon_process_is_running(tracked_pid)
        ):
            raise click.ClickException(f"Scout daemon is already running (PID {tracked_pid}).")
        claimed = await store.claim_daemon_start(
            config_path=str(config_path),
            profile_name=profile_name,
            target_count=target_count,
            interval_seconds=interval_seconds,
            interval_basis=interval_basis,
            expected_status=str(daemon_state["status"]),
            expected_process_id=tracked_pid if isinstance(tracked_pid, int) else None,
            expected_updated_at=str(daemon_state["updated_at"]),
        )
        if not claimed:
            latest_daemon_state = await store.get_daemon_state()
            raise click.ClickException(_daemon_start_conflict_message(latest_daemon_state))
        if daemon_state["status"] == "running":
            if isinstance(tracked_pid, int):
                console.print(
                    f"[yellow]Cleared stale daemon state for PID {tracked_pid} before restart.[/]"
                )
            else:
                console.print("[yellow]Cleared stale daemon state before restart.[/]")
    finally:
        await store.close()

    process: subprocess.Popen[bytes] | None = None
    try:
        process = _spawn_daemon_process(
            config_path=config_path,
            debug=debug,
            search_api_key=search_api_key,
            interval=interval,
        )
        await _wait_for_daemon_start(config, expected_pid=process.pid, process=process)
    except Exception:
        if process is not None and process.poll() is None:
            with suppress(ProcessLookupError):
                _signal_daemon_process(process.pid)
        await _clear_failed_daemon_start(
            config,
            expected_pid=process.pid if process is not None else None,
        )
        raise

    console.print(
        f"[bold green]Daemon started.[/] PID {process.pid} tracking {target_count} schedule targets."
    )


async def _daemon_stop(config: ScoutConfig) -> None:
    """Stop the tracked local Scout daemon process."""
    store = await _open_store(config)
    try:
        daemon_state = await store.get_daemon_state()
        tracked_pid = daemon_state.get("process_id")
        if daemon_state["status"] != "running":
            console.print("[yellow]Daemon is not running.[/]")
            return
        if not isinstance(tracked_pid, int):
            await store.stop_daemon()
            console.print("[yellow]Daemon metadata had no PID. State reconciled to stopped.[/]")
            return
        if not _daemon_process_is_running(tracked_pid):
            await store.stop_daemon()
            console.print(
                f"[yellow]Tracked daemon process {tracked_pid} was already gone. State reconciled.[/]"
            )
            return

        try:
            _signal_daemon_process(tracked_pid)
        except ProcessLookupError:
            await store.stop_daemon()
            console.print(
                f"[yellow]Tracked daemon process {tracked_pid} exited before stop signal. "
                "State reconciled.[/]"
            )
            return
        except PermissionError as exc:
            raise click.ClickException(
                f"Permission denied while stopping tracked daemon process {tracked_pid}."
            ) from exc
        await _wait_for_daemon_stop(store, process_id=tracked_pid)
    finally:
        await store.close()

    console.print(f"[bold green]Daemon stopped.[/] PID {tracked_pid}")


async def _daemon_status(config: ScoutConfig) -> None:
    """Print the current local daemon lifecycle state."""
    store = await _open_store(config)
    try:
        daemon_state = await store.get_daemon_state()
        recent_runs = await store.list_runs(limit=1)
    finally:
        await store.close()

    tracked_pid = daemon_state.get("process_id")
    rendered_state = str(daemon_state["status"])
    if (
        rendered_state == "running"
        and isinstance(tracked_pid, int)
        and not _daemon_process_is_running(tracked_pid)
    ):
        rendered_state = "stale"

    target_count_value = daemon_state.get("target_count")
    target_count = (
        target_count_value
        if isinstance(target_count_value, int) and target_count_value > 0
        else len(config.schedule.targets)
    )
    interval_basis = str(daemon_state.get("interval_basis") or f"cron {config.schedule.cron}")
    interval_seconds = daemon_state.get("interval_seconds")

    console.print("[bold]Scout daemon[/]")
    console.print(f"  State: {rendered_state}")
    console.print(f"  Targets: {target_count}")
    if isinstance(tracked_pid, int):
        console.print(f"  PID: {tracked_pid}")
    interval_suffix = f" (~{interval_seconds}s)" if isinstance(interval_seconds, int) else ""
    console.print(f"  Interval: {interval_basis}{interval_suffix}")
    if daemon_state.get("config_path"):
        console.print(f"  Config: {daemon_state['config_path']}")
    if daemon_state.get("profile_name"):
        console.print(f"  Profile: {daemon_state['profile_name']}")
    if daemon_state.get("started_at"):
        console.print(f"  Started: {str(daemon_state['started_at'])[:19]}")
    if daemon_state.get("last_heartbeat_at"):
        console.print(f"  Last heartbeat: {str(daemon_state['last_heartbeat_at'])[:19]}")
    console.print(f"  Recent tick: {_render_recent_tick_summary(daemon_state)}")
    console.print(
        f"  Recent run: {_render_recent_run_summary(recent_runs[0] if recent_runs else None)}"
    )


async def _daemon_run_internal(
    config: ScoutConfig,
    *,
    config_path: Path,
    profile_name: str | None,
    search_api_key: str,
    interval: int,
) -> None:
    """Run the hidden scheduler loop used by the local daemon process."""
    _require_schedule_targets(config)

    from atlas_scout.scheduler import SchedulerDaemonLifecycle, run_schedule_loop

    stop_event = asyncio.Event()
    _install_daemon_signal_handlers(stop_event)
    lifecycle = SchedulerDaemonLifecycle(
        config_path=str(config_path),
        profile_name=profile_name,
    )
    await run_schedule_loop(
        config,
        search_api_key,
        interval_seconds=interval,
        lifecycle=lifecycle,
        stop_event=stop_event,
    )
