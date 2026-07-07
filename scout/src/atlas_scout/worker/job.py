"""Claimed Atlas worker job payload parsing and execution."""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING

from atlas_scout.pipeline_commands import _run_pipeline
from atlas_scout.worker.api_client import (
    _worker_api_token,
    _worker_complete_job,
    _worker_fail_job,
    _worker_heartbeat_job,
)
from atlas_scout.worker.errors import WorkerJobError
from atlas_scout.worker.state import _now_iso, _write_worker_state

if TYPE_CHECKING:
    from atlas_scout.auth import ScoutSession
    from atlas_scout.config import ScoutConfig


def _worker_job_issues(job: dict[str, object]) -> list[str]:
    """Return issue slugs from a worker job payload."""
    raw_issues = job.get("issue_areas")
    if not isinstance(raw_issues, list) or not all(isinstance(item, str) for item in raw_issues):
        raise WorkerJobError("Atlas worker job is missing issue areas.")
    return list(raw_issues)


def _worker_job_execution_mode(job: dict[str, object]) -> str:
    """Return the worker execution mode for a claimed job."""
    raw_mode = job.get("execution_mode", "search")
    if raw_mode not in {"search", "direct_url"}:
        raise WorkerJobError(f"Unsupported Atlas worker job mode: {raw_mode}")
    return str(raw_mode)


def _worker_job_direct_urls(job: dict[str, object]) -> list[str]:
    """Return seed URLs from a direct-URL worker job payload."""
    payload = job.get("input_payload")
    if not isinstance(payload, dict):
        raise WorkerJobError("Atlas direct-URL job is missing input payload.")
    raw_urls = payload.get("direct_urls")
    if not isinstance(raw_urls, list) or not all(isinstance(url, str) for url in raw_urls):
        raise WorkerJobError("Atlas direct-URL job is missing direct URLs.")
    urls = [url.strip() for url in raw_urls if url.strip()]
    if not urls:
        raise WorkerJobError("Atlas direct-URL job has no usable direct URLs.")
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
