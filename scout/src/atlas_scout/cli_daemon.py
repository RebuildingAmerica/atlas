"""Daemon lifecycle helpers for the Atlas Scout CLI."""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import click

from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig
    from atlas_scout.store import ScoutStore

__all__ = [
    "_clear_failed_daemon_start",
    "_daemon_interval_metadata",
    "_daemon_process_is_running",
    "_daemon_run_internal",
    "_daemon_start",
    "_daemon_start_claim_is_stale",
    "_daemon_start_conflict_message",
    "_daemon_status",
    "_daemon_stop",
    "_install_daemon_signal_handlers",
    "_open_store",
    "_render_recent_run_summary",
    "_render_recent_tick_summary",
    "_require_schedule_targets",
    "_signal_daemon_process",
    "_spawn_daemon_process",
    "_wait_for_daemon_start",
    "_wait_for_daemon_stop",
    "asyncio",
    "console",
    "os",
    "signal",
    "subprocess",
]

# ---------------------------------------------------------------------------
# daemon — Operator-facing local scheduler controls
# ---------------------------------------------------------------------------


def _require_schedule_targets(config: ScoutConfig) -> int:
    """Return the configured target count or fail if none are defined."""
    target_count = len(config.schedule.targets)
    if target_count <= 0:
        raise click.ClickException(
            "No schedule targets configured. Add targets to your config under [schedule.targets]."
        )
    return target_count


async def _open_store(config: ScoutConfig) -> ScoutStore:
    """Open the local Scout store for daemon lifecycle commands."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    return store


def _daemon_process_is_running(process_id: int) -> bool:
    """Return True when the tracked daemon process is still alive."""
    if process_id <= 0:
        return False
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _signal_daemon_process(process_id: int) -> None:
    """Send SIGTERM to the tracked daemon process or process group."""
    if hasattr(os, "killpg"):
        os.killpg(process_id, signal.SIGTERM)
        return
    os.kill(process_id, signal.SIGTERM)


def _spawn_daemon_process(
    *,
    config_path: Path,
    debug: bool,
    search_api_key: str,
    interval: int,
) -> subprocess.Popen[bytes]:
    """Launch the hidden daemon runner as a detached local background process."""
    command = [sys.executable, "-m", "atlas_scout.cli", "--config", str(config_path)]
    if debug:
        command.append("--debug")
    command.extend(["daemon", "run-internal"])
    if interval > 0:
        command.extend(["--interval", str(interval)])

    env = os.environ.copy()
    env["SEARCH_API_KEY"] = search_api_key
    return subprocess.Popen(
        command,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


async def _wait_for_daemon_start(
    config: ScoutConfig,
    *,
    expected_pid: int,
    process: subprocess.Popen[bytes],
    timeout_seconds: float = 5.0,
    poll_interval_seconds: float = 0.1,
) -> dict[str, object]:
    """Wait for the background daemon to report a running state."""
    store = await _open_store(config)
    try:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        while asyncio.get_running_loop().time() < deadline:
            daemon_state = await store.get_daemon_state()
            if (
                daemon_state["status"] == "running"
                and daemon_state.get("process_id") == expected_pid
            ):
                return daemon_state
            if process.poll() is not None:
                raise click.ClickException("Scout daemon exited before reporting ready.")
            await asyncio.sleep(poll_interval_seconds)
    finally:
        await store.close()

    raise click.ClickException("Scout daemon did not report ready before timeout.")


async def _wait_for_daemon_stop(
    store: ScoutStore,
    *,
    process_id: int,
    timeout_seconds: float = 10.0,
    poll_interval_seconds: float = 0.1,
) -> dict[str, object]:
    """Wait for a daemon process to stop and reconcile stale local state if needed."""
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        daemon_state = await store.get_daemon_state()
        if daemon_state["status"] == "stopped":
            return daemon_state
        if not _daemon_process_is_running(process_id):
            await store.stop_daemon()
            return await store.get_daemon_state()
        await asyncio.sleep(poll_interval_seconds)

    raise click.ClickException(f"Timed out waiting for daemon process {process_id} to stop.")


def _render_recent_run_summary(run_record: dict[str, object] | None) -> str:
    """Format the most recent local run for daemon status output."""
    if run_record is None:
        return "none recorded"
    location = str(run_record.get("location") or "—")
    status = str(run_record.get("status") or "unknown")
    entries_value = run_record.get("entries_found")
    entries = entries_value if isinstance(entries_value, int) else 0
    return f"{run_record['id']} · {status} · {location} · {entries} entries"


def _render_recent_tick_summary(daemon_state: dict[str, object]) -> str:
    """Format the last scheduler tick summary from daemon state."""
    last_tick_summary = daemon_state.get("last_tick_summary")
    if not isinstance(last_tick_summary, dict):
        return "none recorded"
    summary = str(last_tick_summary.get("summary") or "no summary")
    completed_at = last_tick_summary.get("completed_at")
    if completed_at:
        return f"{summary} ({str(completed_at)[:19]})"
    return summary


def _daemon_interval_metadata(config: ScoutConfig, *, interval: int) -> tuple[int, str]:
    """Resolve the daemon interval metadata persisted during startup."""
    if interval > 0:
        return interval, f"fixed {interval}s override"
    from atlas_scout.scheduler import _cron_to_interval

    return _cron_to_interval(config.schedule.cron), f"cron {config.schedule.cron}"


def _daemon_start_conflict_message(daemon_state: dict[str, object]) -> str:
    """Render a user-friendly daemon start conflict message."""
    tracked_pid = daemon_state.get("process_id")
    status = daemon_state.get("status")
    if status == "running" and isinstance(tracked_pid, int):
        return f"Scout daemon is already running (PID {tracked_pid})."
    if status == "starting":
        return "Scout daemon is already being started by another process."
    return "Scout daemon state changed during start. Check `scout daemon status` and retry."


def _daemon_start_claim_is_stale(
    daemon_state: dict[str, object], *, stale_after_seconds: float = 10.0
) -> bool:
    """Return True when a start-in-progress claim has aged past the expected startup window."""
    if daemon_state.get("status") != "starting":
        return False
    updated_at = daemon_state.get("updated_at")
    if not isinstance(updated_at, str):
        return False
    try:
        updated_at_value = datetime.fromisoformat(updated_at)
    except ValueError:
        return False
    if updated_at_value.tzinfo is None or updated_at_value.utcoffset() is None:
        updated_at_value = updated_at_value.replace(tzinfo=UTC)
    age_seconds = (datetime.now(UTC) - updated_at_value.astimezone(UTC)).total_seconds()
    return age_seconds >= stale_after_seconds


async def _clear_failed_daemon_start(config: ScoutConfig, *, expected_pid: int | None) -> None:
    """Release a failed daemon start claim when the spawned process never became ready."""
    store = await _open_store(config)
    try:
        daemon_state = await store.get_daemon_state()
        tracked_pid = daemon_state.get("process_id")
        allowed_pids: set[int | None] = {None}
        if expected_pid is not None:
            allowed_pids.add(expected_pid)
        if daemon_state["status"] == "starting" and tracked_pid in allowed_pids:
            await store.stop_daemon()
        if (
            daemon_state["status"] == "running"
            and tracked_pid in allowed_pids
            and not (isinstance(tracked_pid, int) and _daemon_process_is_running(tracked_pid))
        ):
            await store.stop_daemon()
    finally:
        await store.close()


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


def _install_daemon_signal_handlers(stop_event: asyncio.Event) -> None:
    """Register signal handlers that ask the daemon loop to shut down cleanly."""
    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        stop_event.set()

    def _request_stop_threadsafe(_sig: int, _frame: object | None) -> None:
        loop.call_soon_threadsafe(stop_event.set)

    for current_signal in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(current_signal, _request_stop)
        except (NotImplementedError, RuntimeError):
            signal.signal(current_signal, _request_stop_threadsafe)


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
