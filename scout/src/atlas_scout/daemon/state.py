"""Daemon store access and start/stop reconciliation helpers."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import click

from atlas_scout.daemon.process import _daemon_process_is_running

if TYPE_CHECKING:
    import subprocess

    from atlas_scout.config import ScoutConfig
    from atlas_scout.store import ScoutStore


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
