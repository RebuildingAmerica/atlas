"""Poll-based discovery job runner.

A background asyncio task that polls for queued discovery jobs, claims them
with a lease, runs the pipeline, and handles retries on failure. Designed
to survive process restarts: unclaimed jobs re-enter the queue automatically.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
import weakref

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
    run_discovery_pipeline,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings

logger = logging.getLogger(__name__)

__all__ = ["notify_job_queued", "start_job_worker", "stop_job_worker"]

_POLL_INTERVAL_SECONDS = 10
# Neon suspends an idle database after five minutes, but a worker polling every
# ten seconds kept it awake for as long as any API instance lived, and that
# spent the plan's compute allowance and took the API down on September 29.
# With nothing queued the worker waits twice as long each time, up to fifteen
# minutes, so an idle database can suspend; a newly queued job wakes it at once.
_IDLE_WAIT_MAX_SECONDS = 900
# One wake-up signal per event loop, so a queued job only wakes the worker
# running on the loop that queued it.
_work_queued: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Event] = (
    weakref.WeakKeyDictionary()
)
_LEASE_SECONDS = 900
# A run that reads the nonprofit register and its IRS returns takes 10 to 20
# minutes, longer than one lease. Renewing well inside the lease keeps another
# worker from reclaiming and re-running a job that is still healthily working,
# while a crashed instance still lets its job lapse within one lease.
_LEASE_RENEWAL_SECONDS = 60

_worker_task: asyncio.Task[None] | None = None


async def start_job_worker(
    database_url: str,
    *,
    database_backend: str | None = None,
    anthropic_api_key: str = "",
    search_api_key: str | None = None,
    settings: Settings | None = None,
) -> None:
    """Start the background job worker loop."""
    global _worker_task  # noqa: PLW0603
    if _worker_task is not None and not _worker_task.done():
        logger.warning("Job worker already running")
        return

    _worker_task = asyncio.create_task(
        _worker_loop(
            database_url,
            database_backend=database_backend,
            anthropic_api_key=anthropic_api_key,
            search_api_key=search_api_key,
            settings=settings,
        ),
        name="discovery-job-worker",
    )
    logger.info("Discovery job worker started")


async def stop_job_worker() -> None:
    """Stop the background job worker loop."""
    global _worker_task  # noqa: PLW0603
    if _worker_task is None or _worker_task.done():
        return
    _worker_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _worker_task
    _worker_task = None
    logger.info("Discovery job worker stopped")


def _work_queued_event() -> asyncio.Event:
    """Return the running loop's wake-up signal, creating it on first use."""
    loop = asyncio.get_running_loop()
    event = _work_queued.get(loop)
    if event is None:
        event = asyncio.Event()
        _work_queued[loop] = event
    return event


def notify_job_queued() -> None:
    """Wake this process's worker because a job was just queued."""
    _work_queued_event().set()


def _next_idle_wait(seconds: float) -> float:
    """Return the next empty-poll wait: double the last, up to the ceiling.

    Parameters
    ----------
    seconds : float
        The wait just used.

    Returns
    -------
    float
        The wait to use after another empty poll.
    """
    return min(seconds * 2, _IDLE_WAIT_MAX_SECONDS)


async def _wait_for_work(seconds: float) -> None:
    """Wait until a job is queued in this process or ``seconds`` pass.

    Parameters
    ----------
    seconds : float
        The longest time to wait before polling again.
    """
    event = _work_queued_event()
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(event.wait(), timeout=seconds)
    event.clear()


async def _worker_loop(
    database_url: str,
    *,
    database_backend: str | None = None,
    anthropic_api_key: str = "",
    search_api_key: str | None = None,
    settings: Settings | None = None,
) -> None:
    """Poll for queued jobs and execute them."""
    instance_id = f"worker-{uuid.uuid4().hex[:8]}"
    active_settings = settings or get_settings()
    credentials = DiscoveryPipelineCredentials(
        search_api_key=search_api_key,
        anthropic_api_key=anthropic_api_key,
    )

    idle_wait: float = _POLL_INTERVAL_SECONDS
    while True:
        try:
            conn = await get_db_connection(database_url, backend=database_backend)
            try:
                reaped = await DiscoveryJobCRUD.reap_orphans(conn)
                if reaped:
                    logger.info("Reaped %d stranded discovery job(s)", reaped)

                job = await DiscoveryJobCRUD.claim_next(
                    conn,
                    claimed_by=instance_id,
                    lease_seconds=_LEASE_SECONDS,
                )
                if job is None:
                    await conn.close()
                    await _wait_for_work(idle_wait)
                    idle_wait = _next_idle_wait(idle_wait)
                    continue

                idle_wait = _POLL_INTERVAL_SECONDS

                logger.info("Claimed job %s for run %s", job.id, job.run_id)

                run = await DiscoveryRunCRUD.get_by_id(conn, job.run_id)
                # FK ON DELETE CASCADE: deleting a run also deletes its jobs,
                # so claim_next would not have returned this job if the run
                # were missing.
                assert run is not None, "claimed job's run was deleted concurrently"

                pipeline_job = DiscoveryPipelineJob(
                    run_id=run.id,
                    location_query=run.location_query,
                    state=run.state,
                    issue_areas=run.issue_areas,
                    research_goal=run.research_goal,
                )

                await DiscoveryJobCRUD.update_progress(
                    conn,
                    job.id,
                    {
                        "step": "running",
                        "run_id": run.id,
                    },
                    lease_seconds=_LEASE_SECONDS,
                )

                renewal = asyncio.create_task(
                    _renew_lease(
                        database_url,
                        database_backend=database_backend,
                        job_id=job.id,
                        progress={"step": "running", "run_id": run.id},
                    ),
                    name=f"discovery-lease-{job.id}",
                )
                try:
                    await run_discovery_pipeline(
                        conn,
                        job=pipeline_job,
                        credentials=credentials,
                        settings=active_settings,
                    )
                    await DiscoveryJobCRUD.complete(conn, job.id)
                    logger.info("Job %s completed successfully", job.id)
                except Exception as exc:
                    error_msg = str(exc)[:500]
                    requeued = await DiscoveryJobCRUD.fail(conn, job.id, error_msg)
                    if requeued:
                        logger.warning("Job %s failed, re-queued for retry: %s", job.id, error_msg)
                    else:
                        logger.exception("Job %s failed permanently: %s", job.id, error_msg)
                finally:
                    renewal.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await renewal

            finally:
                await conn.close()

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Job worker encountered an unexpected error")
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)


async def _renew_lease(
    database_url: str,
    *,
    database_backend: str | None,
    job_id: str,
    progress: dict[str, str],
) -> None:
    """Push a running job's lease forward until the run finishes.

    Each renewal opens its own connection, because the pipeline holds the
    worker's connection inside its own transactions and a renewal must never
    interleave with them. A renewal that fails is logged and retried on the
    next tick; if every renewal fails the lease lapses and the job is retried,
    which is the same outcome as the instance dying.

    Parameters
    ----------
    database_url : str
        Database the job lives in.
    database_backend : str | None
        Backend override, as the worker loop received it.
    job_id : str
        The job whose lease to keep.
    progress : dict[str, str]
        Progress payload to write with each renewal.
    """
    while True:
        await asyncio.sleep(_LEASE_RENEWAL_SECONDS)
        try:
            conn = await get_db_connection(database_url, backend=database_backend)
            try:
                await DiscoveryJobCRUD.update_progress(
                    conn, job_id, progress, lease_seconds=_LEASE_SECONDS
                )
            finally:
                await conn.close()
        except Exception:
            logger.warning("Lease renewal failed for job %s", job_id, exc_info=True)
