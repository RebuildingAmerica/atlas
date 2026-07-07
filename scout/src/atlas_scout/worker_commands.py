"""Atlas worker commands for Scout."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

import click

from atlas_scout.auth import DeviceAuthClient, ScoutSession, UploadTarget
from atlas_scout.auth_commands import (
    _default_worker_name,
    _load_session_or_click_exception,
)
from atlas_scout.cli_common import ScoutSyncError, _exit_with_error, _run_async
from atlas_scout.cli_context import console
from atlas_scout.cli_daemon import (
    _daemon_process_is_running,
    _install_daemon_signal_handlers,
    _signal_daemon_process,
)
from atlas_scout.cli_errors import CliError
from atlas_scout.config import SCOUT_CONFIG_DIR, ScoutConfig
from atlas_scout.credentials import CredentialStoreError
from atlas_scout.local_model_commands import (
    _prepare_local_model_config,
    _require_local_worker_provider,
)
from atlas_scout.pipeline_commands import _run_pipeline
from atlas_scout.search_keys import resolve_search_api_key

if TYPE_CHECKING:
    from pathlib import Path

WORKER_STATE_PATH = SCOUT_CONFIG_DIR / "worker.json"
_WORKER_STOPPED_STATE: dict[str, object] = {
    "atlas_url": None,
    "current_job_id": None,
    "last_completed_job_id": None,
    "last_error": None,
    "last_heartbeat_at": None,
    "mode": "stopped",
    "process_id": None,
    "search_key_configured": False,
    "started_at": None,
    "status": "stopped",
    "worker_id": None,
    "worker_name": None,
}


def _now_iso() -> str:
    """Return a UTC timestamp for worker state files."""
    return datetime.now(UTC).isoformat()


def _read_worker_state() -> dict[str, object]:
    """Read the local Atlas worker state file."""
    if not WORKER_STATE_PATH.exists():
        return {"status": "stopped"}
    with WORKER_STATE_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {"status": "stopped"}
    return cast("dict[str, object]", payload)


def _write_worker_state(**state: object) -> None:
    """Persist local Atlas worker state."""
    payload = {**_read_worker_state(), **state, "updated_at": _now_iso()}
    WORKER_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with WORKER_STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    WORKER_STATE_PATH.chmod(0o600)


def _resolve_optional_worker_search_key(search_api_key: str | None) -> str:
    """Return a search key for worker jobs, or empty when storage is unavailable."""
    try:
        return resolve_search_api_key(search_api_key)
    except CredentialStoreError:
        return ""


def _write_stopped_worker_state() -> None:
    """Persist a stopped worker state without stale live metadata."""
    _write_worker_state(**_WORKER_STOPPED_STATE)


def _worker_state_running(state: dict[str, object]) -> bool:
    """Return whether the tracked Atlas worker process is running."""
    process_id = state.get("process_id")
    return (
        state.get("status") == "running"
        and isinstance(process_id, int)
        and _daemon_process_is_running(process_id)
    )


async def _worker_api_token(
    *,
    atlas_url: str,
    session: ScoutSession,
    search_api_key: str,
) -> str:
    """Exchange the saved Scout session for a short-lived API token."""
    default_upload_target: UploadTarget = session.default_upload_target or "public"
    workspace_id = session.workspace_id if default_upload_target == "workspace" else None
    exchange = await DeviceAuthClient().exchange_session_for_api_token(
        atlas_url,
        session_token=session.access_token,
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        default_upload_target=default_upload_target,
        workspace_id=workspace_id,
        search_key_configured=bool(search_api_key),
    )
    return exchange.token


async def _worker_post(
    *,
    atlas_url: str,
    token: str,
    path: str,
    payload: dict[str, object],
) -> dict[str, object]:
    """POST to the Atlas worker API and return a JSON object."""
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{atlas_url.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.is_error:
        raise ScoutSyncError(f"Atlas worker API failed: HTTP {response.status_code}")
    body = response.json()
    if not isinstance(body, dict):
        raise ScoutSyncError("Atlas worker API returned an invalid response.")
    return cast("dict[str, object]", body)


async def _worker_claim_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    lease_seconds: int,
    search_key_configured: bool,
) -> dict[str, object] | None:
    """Claim the next Atlas discovery job, if any."""
    body = await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path="/api/discovery-runs/jobs/claim",
        payload={
            "worker_id": worker_id,
            "lease_seconds": lease_seconds,
            "search_key_configured": search_key_configured,
        },
    )
    job = body.get("job")
    if job is None:
        return None
    if not isinstance(job, dict):
        raise ScoutSyncError("Atlas worker claim returned an invalid job.")
    return cast("dict[str, object]", job)


async def _worker_heartbeat_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
    lease_seconds: int,
    progress: dict[str, object],
) -> None:
    """Renew one Atlas job lease."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/heartbeat",
        payload={
            "worker_id": worker_id,
            "lease_seconds": lease_seconds,
            "progress": progress,
        },
    )


async def _worker_complete_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
) -> None:
    """Mark one Atlas job lease complete."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/complete",
        payload={"worker_id": worker_id},
    )


async def _worker_fail_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
    error_message: str,
    retryable: bool,
) -> None:
    """Report one failed Atlas job lease."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/fail",
        payload={
            "worker_id": worker_id,
            "error_message": error_message,
            "retryable": retryable,
        },
    )


def _worker_job_issues(job: dict[str, object]) -> list[str]:
    """Return issue slugs from a worker job payload."""
    raw_issues = job.get("issue_areas")
    if not isinstance(raw_issues, list) or not all(isinstance(item, str) for item in raw_issues):
        raise ScoutSyncError("Atlas worker job is missing issue areas.")
    return list(raw_issues)


def _worker_job_execution_mode(job: dict[str, object]) -> str:
    """Return the worker execution mode for a claimed job."""
    raw_mode = job.get("execution_mode", "search")
    if raw_mode not in {"search", "direct_url"}:
        raise ScoutSyncError(f"Unsupported Atlas worker job mode: {raw_mode}")
    return str(raw_mode)


def _worker_job_direct_urls(job: dict[str, object]) -> list[str]:
    """Return seed URLs from a direct-URL worker job payload."""
    payload = job.get("input_payload")
    if not isinstance(payload, dict):
        raise ScoutSyncError("Atlas direct-URL job is missing input payload.")
    raw_urls = payload.get("direct_urls")
    if not isinstance(raw_urls, list) or not all(isinstance(url, str) for url in raw_urls):
        raise ScoutSyncError("Atlas direct-URL job is missing direct URLs.")
    urls = [url.strip() for url in raw_urls if url.strip()]
    if not urls:
        raise ScoutSyncError("Atlas direct-URL job has no usable direct URLs.")
    return urls


async def _worker_process_job(
    config: ScoutConfig,
    *,
    atlas_url: str,
    session: ScoutSession,
    token: str,
    job: dict[str, object],
    search_api_key: str,
    lease_seconds: int,
) -> None:
    """Run one claimed Atlas worker job and report completion or failure."""
    job_id = str(job["id"])
    run_id = str(job["run_id"])
    location = str(job["location_query"])
    issues = _worker_job_issues(job)
    execution_mode = _worker_job_execution_mode(job)
    direct_urls = _worker_job_direct_urls(job) if execution_mode == "direct_url" else None

    _write_worker_state(
        mode="processing",
        current_job_id=job_id,
        current_location=location,
        last_heartbeat_at=_now_iso(),
    )
    await _worker_heartbeat_job(
        atlas_url=atlas_url,
        token=token,
        worker_id=session.worker_id,
        job_id=job_id,
        lease_seconds=lease_seconds,
        progress={"step": "claimed", "claimed_at": _now_iso()},
    )

    heartbeat_stop = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        _worker_heartbeat_loop(
            atlas_url=atlas_url,
            session=session,
            search_api_key=search_api_key,
            job_id=job_id,
            lease_seconds=lease_seconds,
            stop_event=heartbeat_stop,
        )
    )
    try:
        await _run_pipeline(
            config=config,
            location=location,
            issues=issues,
            depth="standard",
            search_api_key=search_api_key,
            direct_urls=direct_urls,
            quiet=True,
            sync_after_run=True,
            sync_remote_run_id=run_id,
        )
    except Exception as exc:
        failure_token = await _worker_api_token(
            atlas_url=atlas_url,
            session=session,
            search_api_key=search_api_key,
        )
        await _worker_fail_job(
            atlas_url=atlas_url,
            token=failure_token,
            worker_id=session.worker_id,
            job_id=job_id,
            error_message=str(exc),
            retryable=True,
        )
        _write_worker_state(
            mode="error",
            current_job_id=None,
            last_error=str(exc),
            last_heartbeat_at=_now_iso(),
        )
        return
    finally:
        heartbeat_stop.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    complete_token = await _worker_api_token(
        atlas_url=atlas_url,
        session=session,
        search_api_key=search_api_key,
    )
    await _worker_complete_job(
        atlas_url=atlas_url,
        token=complete_token,
        worker_id=session.worker_id,
        job_id=job_id,
    )
    _write_worker_state(
        mode="idle",
        current_job_id=None,
        last_completed_job_id=job_id,
        last_heartbeat_at=_now_iso(),
    )


async def _worker_heartbeat_loop(
    *,
    atlas_url: str,
    session: ScoutSession,
    search_api_key: str,
    job_id: str,
    lease_seconds: int,
    stop_event: asyncio.Event,
) -> None:
    """Heartbeat a running Atlas job until processing finishes."""
    interval = max(10, min(60, lease_seconds // 3))
    while not stop_event.is_set():
        await asyncio.sleep(interval)
        if stop_event.is_set():
            return
        token = await _worker_api_token(
            atlas_url=atlas_url,
            session=session,
            search_api_key=search_api_key,
        )
        await _worker_heartbeat_job(
            atlas_url=atlas_url,
            token=token,
            worker_id=session.worker_id,
            job_id=job_id,
            lease_seconds=lease_seconds,
            progress={"step": "running", "heartbeat_at": _now_iso()},
        )
        _write_worker_state(last_heartbeat_at=_now_iso())


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
    command = [sys.executable, "-m", "atlas_scout.cli", "--config", str(config_path)]
    if debug:
        command.append("--debug")
    command.extend(["worker", "run-internal", "--interval", str(interval)])
    command.extend(["--lease-seconds", str(lease_seconds)])
    if atlas_url:
        command.extend(["--atlas-url", atlas_url])
    if search_api_key:
        command.extend(["--search-api-key", search_api_key])
    env = os.environ.copy()
    if search_api_key:
        env["SEARCH_API_KEY"] = search_api_key
    return subprocess.Popen(
        command,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
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
