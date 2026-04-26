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

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
    run_discovery_pipeline,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection

logger = logging.getLogger(__name__)

__all__ = ["start_job_worker", "stop_job_worker"]

_POLL_INTERVAL_SECONDS = 10
_LEASE_SECONDS = 900

_worker_task: asyncio.Task[None] | None = None


async def start_job_worker(
    database_url: str,
    *,
    database_backend: str | None = None,
    anthropic_api_key: str = "",
    search_api_key: str | None = None,
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


async def _worker_loop(
    database_url: str,
    *,
    database_backend: str | None = None,
    anthropic_api_key: str = "",
    search_api_key: str | None = None,
) -> None:
    """Poll for queued jobs and execute them."""
    instance_id = f"worker-{uuid.uuid4().hex[:8]}"
    credentials = DiscoveryPipelineCredentials(
        search_api_key=search_api_key,
        anthropic_api_key=anthropic_api_key,
    )

    while True:
        try:
            conn = await get_db_connection(database_url, backend=database_backend)
            try:
                job = await DiscoveryJobCRUD.claim_next(
                    conn,
                    claimed_by=instance_id,
                    lease_seconds=_LEASE_SECONDS,
                )
                if job is None:
                    await conn.close()
                    await asyncio.sleep(_POLL_INTERVAL_SECONDS)
                    continue

                logger.info("Claimed job %s for run %s", job.id, job.run_id)

                run = await DiscoveryRunCRUD.get_by_id(conn, job.run_id)
                if run is None:
                    logger.error("Job %s references missing run %s", job.id, job.run_id)
                    await DiscoveryJobCRUD.fail(conn, job.id, "referenced run does not exist")
                    await conn.close()
                    continue

                pipeline_job = DiscoveryPipelineJob(
                    run_id=run.id,
                    location_query=run.location_query,
                    state=run.state,
                    issue_areas=run.issue_areas,
                )

                await DiscoveryJobCRUD.update_progress(
                    conn,
                    job.id,
                    {
                        "step": "running",
                        "run_id": run.id,
                    },
                )

                try:
                    await run_discovery_pipeline(conn, job=pipeline_job, credentials=credentials)
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
                await conn.close()

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Job worker encountered an unexpected error")
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
