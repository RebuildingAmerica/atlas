"""Foreground loop and start/stop/status orchestration for the Atlas worker."""

from __future__ import annotations

import asyncio
import contextlib
import os
from typing import TYPE_CHECKING

import click

from atlas_scout.auth_commands import _default_worker_name, _load_session_or_click_exception
from atlas_scout.cli_context import console
from atlas_scout.daemon import (
    _install_daemon_signal_handlers,
    _signal_daemon_process,
    spawn_detached_scout_process,
)
from atlas_scout.local_model_commands import (
    _prepare_local_model_config,
    _require_local_worker_provider,
)
from atlas_scout.worker.api_client import _worker_api_token, _worker_claim_job
from atlas_scout.worker.job import _worker_process_job
from atlas_scout.worker.state import (
    _now_iso,
    _read_worker_state,
    _resolve_optional_worker_search_key,
    _worker_state_running,
    _write_stopped_worker_state,
    _write_worker_state,
)

if TYPE_CHECKING:
    import subprocess
    from pathlib import Path

    from atlas_scout.config import ScoutConfig


async def _worker_run_internal(
    config: ScoutConfig,
    *,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Run the Atlas worker foreground loop used by the background process."""
    session = _load_session_or_click_exception()
    if session is None:
        raise click.ClickException("Log in with `scout login` before starting the worker.")
    _require_local_worker_provider(config)
    resolved_atlas_url = (atlas_url or session.atlas_url).rstrip("/")
    resolved_search_key = _resolve_optional_worker_search_key(search_api_key)
    stop_event = asyncio.Event()
    _install_daemon_signal_handlers(stop_event)
    _write_worker_state(
        status="running",
        process_id=os.getpid(),
        atlas_url=resolved_atlas_url,
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        search_key_configured=bool(resolved_search_key),
        started_at=_now_iso(),
    )

    while not stop_event.is_set():
        if not resolved_search_key:
            _write_worker_state(mode="waiting_for_seeded_jobs", current_job_id=None)

        try:
            token = await _worker_api_token(
                atlas_url=resolved_atlas_url,
                session=session,
                search_api_key=resolved_search_key,
            )
            job = await _worker_claim_job(
                atlas_url=resolved_atlas_url,
                token=token,
                worker_id=session.worker_id,
                lease_seconds=lease_seconds,
                search_key_configured=bool(resolved_search_key),
            )
            if job is None:
                _write_worker_state(
                    mode="idle" if resolved_search_key else "waiting_for_seeded_jobs",
                    current_job_id=None,
                    last_heartbeat_at=_now_iso(),
                )
                await asyncio.sleep(interval)
                continue

            await _worker_process_job(
                config,
                atlas_url=resolved_atlas_url,
                session=session,
                token=token,
                job=job,
                search_api_key=resolved_search_key,
                lease_seconds=lease_seconds,
            )
        except Exception as exc:
            _write_worker_state(
                mode="error",
                current_job_id=None,
                last_error=str(exc),
                last_heartbeat_at=_now_iso(),
            )
            await asyncio.sleep(interval)

    _write_stopped_worker_state()


def _spawn_worker_process(
    *,
    config_path: Path,
    debug: bool,
    atlas_url: str | None,
    search_api_key: str,
    interval: int,
    lease_seconds: int,
) -> subprocess.Popen[bytes]:
    """Launch the Atlas worker loop as a detached process."""
    extra_args = [
        "worker",
        "run-internal",
        "--interval",
        str(interval),
        "--lease-seconds",
        str(lease_seconds),
    ]
    if atlas_url:
        extra_args.extend(["--atlas-url", atlas_url])
    if search_api_key:
        extra_args.extend(["--search-api-key", search_api_key])
    env_overrides = {"SEARCH_API_KEY": search_api_key} if search_api_key else None
    return spawn_detached_scout_process(
        config_path=config_path,
        debug=debug,
        extra_args=extra_args,
        env_overrides=env_overrides,
    )


async def _worker_start(
    config: ScoutConfig,
    *,
    config_path: Path,
    debug: bool,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Start the local Atlas worker process."""
    _ = config
    session = _load_session_or_click_exception()
    if session is None:
        raise click.ClickException("Log in with `scout login` before starting the worker.")
    _prepare_local_model_config(config, config_path=config_path)
    _require_local_worker_provider(config)
    state = _read_worker_state()
    if _worker_state_running(state):
        raise click.ClickException(f"Scout worker is already running (PID {state['process_id']}).")
    resolved_search_key = _resolve_optional_worker_search_key(search_api_key)
    process = _spawn_worker_process(
        config_path=config_path,
        debug=debug,
        atlas_url=atlas_url,
        search_api_key=resolved_search_key,
        interval=interval,
        lease_seconds=lease_seconds,
    )
    _write_worker_state(
        status="running",
        mode="starting",
        process_id=process.pid,
        atlas_url=(atlas_url or session.atlas_url).rstrip("/"),
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        search_key_configured=bool(resolved_search_key),
        started_at=_now_iso(),
        current_job_id=None,
    )
    console.print(f"[bold green]Worker started.[/] PID {process.pid}")


async def _worker_stop() -> None:
    """Stop the tracked Atlas worker process."""
    state = _read_worker_state()
    process_id = state.get("process_id")
    if not _worker_state_running(state):
        _write_stopped_worker_state()
        console.print("[yellow]Worker is not running.[/]")
        return
    if not isinstance(process_id, int):
        _write_stopped_worker_state()
        console.print("[yellow]Worker metadata had no PID. State reconciled.[/]")
        return
    with contextlib.suppress(ProcessLookupError):
        _signal_daemon_process(process_id)
    _write_stopped_worker_state()
    console.print(f"[bold green]Worker stopped.[/] PID {process_id}")


def _worker_status() -> None:
    """Print the tracked Atlas worker status."""
    state = _read_worker_state()
    if state.get("status") == "running" and not _worker_state_running(state):
        state = {**state, "status": "stale"}

    console.print("[bold]Scout worker[/]")
    console.print(f"  State: {state.get('status', 'stopped')}")
    if state.get("mode"):
        console.print(f"  Mode: {state['mode']}")
    if state.get("worker_name"):
        console.print(f"  Worker: {state['worker_name']}")
    if isinstance(state.get("process_id"), int):
        console.print(f"  PID: {state['process_id']}")
    if state.get("atlas_url"):
        console.print(f"  Atlas: {state['atlas_url']}")
    configured = "yes" if state.get("search_key_configured") else "no"
    console.print(f"  Search-backed discovery: {configured}")
    if state.get("current_job_id"):
        console.print(f"  Current job: {state['current_job_id']}")
    if state.get("last_completed_job_id"):
        console.print(f"  Last completed job: {state['last_completed_job_id']}")
    if state.get("last_heartbeat_at"):
        console.print(f"  Last heartbeat: {str(state['last_heartbeat_at'])[:19]}")
    if state.get("last_error"):
        console.print(f"  Last error: {state['last_error']}")
