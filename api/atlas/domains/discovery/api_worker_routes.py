"""Discovery run endpoints."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryScheduleCRUD,
)
from atlas.domains.discovery.schemas import (
    DiscoveryJobQueueResponse,
    DiscoveryJobResponse,
    DiscoveryPipelineSummaryResponse,
    DiscoveryWorkerClaimRequest,
    DiscoveryWorkerClaimResponse,
    DiscoveryWorkerCompleteRequest,
    DiscoveryWorkerFailRequest,
    DiscoveryWorkerHeartbeatRequest,
    DiscoveryWorkerJobResponse,
    DiscoveryWorkerReleaseResponse,
    ScheduledRunResponse,
    ScheduledRunResult,
)
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import db as db_manager
from atlas.platform.http.cache import apply_no_store_headers

from .api_helpers import (
    _job_queue_item_to_response,
    _require_worker_job,
    _worker_job_to_response,
    get_db,
)

if TYPE_CHECKING:
    import aiosqlite


logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


@router.post(
    "/scheduled",
    response_model=ScheduledRunResponse,
    status_code=202,
    summary="Enqueue scheduled discovery targets",
    description=(
        "Enqueue a durable discovery job for each enabled schedule target and return "
        "immediately. Designed for invocation by Cloud Scheduler or other cron triggers; "
        "the durable worker performs the discovery work. Re-triggering the same target on "
        "the same day reuses the already-enqueued job, so a duplicate cron fire is a no-op."
    ),
    operation_id="executeScheduledDiscoveryRuns",
    tags=["discovery-runs"],
)
async def execute_scheduled_runs(
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    settings: Settings = Depends(get_settings),
    db: aiosqlite.Connection = Depends(get_db),
) -> ScheduledRunResponse:
    """Enqueue durable discovery jobs for every enabled schedule target."""
    _ = actor
    _ = settings
    response.status_code = 202
    schedules = await DiscoveryScheduleCRUD.list(db, enabled_only=True)
    if not schedules:
        apply_no_store_headers(response)
        return ScheduledRunResponse(enqueued=0, results=[])

    day = db_manager.now_iso()[:10]
    results: list[ScheduledRunResult] = []
    for schedule in schedules:
        idempotency_key = f"sched:{schedule.id}:{day}"
        existing = await DiscoveryJobCRUD.get_by_idempotency_key(db, idempotency_key)
        if existing is not None:
            results.append(
                ScheduledRunResult(
                    schedule_id=schedule.id,
                    run_id=existing.run_id,
                    job_id=existing.id,
                )
            )
            continue

        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query=schedule.location_query,
            state=schedule.state,
            issue_areas=schedule.issue_areas,
            research_goal="landscape_scan",
        )
        job_id = await DiscoveryJobCRUD.create(
            db,
            run_id=run_id,
            idempotency_key=idempotency_key,
        )
        await DiscoveryScheduleCRUD.update(
            db,
            schedule.id,
            last_run_id=run_id,
            last_run_at=db_manager.now_iso(),
        )
        results.append(
            ScheduledRunResult(
                schedule_id=schedule.id,
                run_id=run_id,
                job_id=job_id,
            )
        )

    apply_no_store_headers(response)
    return ScheduledRunResponse(enqueued=len(results), results=results)


@router.get(
    "/jobs",
    response_model=DiscoveryJobQueueResponse,
    summary="List discovery job queue",
    description="Return queued, claimed, running, and failed discovery jobs for research ops.",
    operation_id="listDiscoveryJobQueue",
    tags=["discovery-runs"],
)
async def list_discovery_job_queue(
    response: Response,
    *,
    limit: int = Query(25, ge=1, le=100),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryJobQueueResponse:
    """Return a bounded research-operations queue view."""
    _ = actor
    jobs = await DiscoveryJobCRUD.list_queue(db, limit=limit)
    raw_counts = await DiscoveryJobCRUD.count_by_status(db)
    status_counts = {
        "queued": raw_counts.get("queued", 0),
        "claimed": raw_counts.get("claimed", 0),
        "running": raw_counts.get("running", 0),
        "failed": raw_counts.get("failed", 0),
    }
    apply_no_store_headers(response)
    return DiscoveryJobQueueResponse(
        items=[_job_queue_item_to_response(job) for job in jobs],
        total=sum(status_counts.values()),
        status_counts=status_counts,
    )


@router.post(
    "/jobs/claim",
    response_model=DiscoveryWorkerClaimResponse,
    summary="Claim a discovery job",
    description="Lease the oldest queued discovery job for a Scout host worker.",
    operation_id="claimDiscoveryJob",
    tags=["discovery-runs"],
)
async def claim_discovery_job(
    req: DiscoveryWorkerClaimRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryWorkerClaimResponse:
    """Lease the next queued job for a remote Scout worker."""
    _ = actor
    job = await DiscoveryJobCRUD.claim_next(
        db,
        claimed_by=req.worker_id,
        lease_seconds=req.lease_seconds,
        search_key_configured=req.search_key_configured,
    )
    apply_no_store_headers(response)
    if job is None:
        return DiscoveryWorkerClaimResponse(job=None)
    return DiscoveryWorkerClaimResponse(job=await _worker_job_to_response(db, job))


@router.get(
    "/jobs/{job_id}",
    response_model=DiscoveryJobResponse,
    summary="Get a discovery job",
    description="Return the current status and progress of a discovery pipeline job.",
    operation_id="getDiscoveryJob",
    tags=["discovery-runs"],
)
async def get_discovery_job(
    job_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryJobResponse:
    """Get a job by ID."""
    _ = actor
    job = await DiscoveryJobCRUD.get_by_id(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    apply_no_store_headers(response)
    return DiscoveryJobResponse(
        id=job.id,
        run_id=job.run_id,
        status=job.status,
        execution_mode=job.execution_mode,
        input_payload=job.input_payload,
        progress=job.progress,
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


@router.post(
    "/jobs/{job_id}/heartbeat",
    response_model=DiscoveryWorkerJobResponse,
    summary="Heartbeat a discovery job",
    description="Renew a Scout worker lease and store progress for a claimed discovery job.",
    operation_id="heartbeatDiscoveryJob",
    tags=["discovery-runs"],
)
async def heartbeat_discovery_job(
    job_id: str,
    req: DiscoveryWorkerHeartbeatRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryWorkerJobResponse:
    """Renew a claimed job lease for its current Scout worker."""
    _ = actor
    job = await _require_worker_job(db, job_id=job_id, worker_id=req.worker_id)
    await DiscoveryJobCRUD.update_progress(
        db,
        job.id,
        req.progress,
        lease_seconds=req.lease_seconds,
    )
    refreshed = await DiscoveryJobCRUD.get_by_id(db, job.id)
    if refreshed is None:
        raise HTTPException(status_code=404, detail="Job not found")
    apply_no_store_headers(response)
    return await _worker_job_to_response(db, refreshed)


@router.post(
    "/jobs/{job_id}/complete",
    response_model=DiscoveryWorkerJobResponse,
    summary="Complete a discovery job",
    description="Mark a claimed discovery job complete for the Scout worker holding its lease.",
    operation_id="completeDiscoveryJob",
    tags=["discovery-runs"],
)
async def complete_discovery_job(
    job_id: str,
    req: DiscoveryWorkerCompleteRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryWorkerJobResponse:
    """Complete a claimed job lease for its current Scout worker."""
    _ = actor
    job = await _require_worker_job(db, job_id=job_id, worker_id=req.worker_id)
    await DiscoveryJobCRUD.complete(db, job.id)
    completed = await DiscoveryJobCRUD.get_by_id(db, job.id)
    if completed is None:
        raise HTTPException(status_code=404, detail="Job not found")
    apply_no_store_headers(response)
    return await _worker_job_to_response(db, completed)


@router.post(
    "/jobs/{job_id}/fail",
    response_model=DiscoveryWorkerJobResponse,
    summary="Fail a discovery job",
    description="Mark a Scout worker's leased job failed, retryable, or permanently failed.",
    operation_id="failDiscoveryJob",
    tags=["discovery-runs"],
)
async def fail_discovery_job(
    job_id: str,
    req: DiscoveryWorkerFailRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryWorkerJobResponse:
    """Fail a claimed job lease for its current Scout worker."""
    _ = actor
    job = await _require_worker_job(db, job_id=job_id, worker_id=req.worker_id)
    await DiscoveryJobCRUD.fail(db, job.id, req.error_message, retryable=req.retryable)
    failed = await DiscoveryJobCRUD.get_by_id(db, job.id)
    if failed is None:
        raise HTTPException(status_code=404, detail="Job not found")
    apply_no_store_headers(response)
    return await _worker_job_to_response(db, failed)


@router.post(
    "/jobs/workers/{worker_id}/release",
    response_model=DiscoveryWorkerReleaseResponse,
    summary="Release a Scout worker's active job leases",
    description="Release claimed or running jobs when an enrolled Scout device is revoked.",
    operation_id="releaseDiscoveryWorkerJobs",
    tags=["discovery-runs"],
)
async def release_worker_jobs(
    worker_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryWorkerReleaseResponse:
    """Release active job leases held by one Scout worker."""
    _ = actor
    released = await DiscoveryJobCRUD.release_worker_leases(db, worker_id)
    apply_no_store_headers(response)
    return DiscoveryWorkerReleaseResponse(worker_id=worker_id, jobs_released=released)


@router.get(
    "/summary",
    response_model=DiscoveryPipelineSummaryResponse,
    summary="Pipeline health summary",
    description="Aggregate counts of jobs, runs, and entries for pipeline observability.",
    operation_id="getDiscoveryPipelineSummary",
    tags=["discovery-runs"],
)
async def get_pipeline_summary(
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryPipelineSummaryResponse:
    """Return aggregate pipeline health metrics."""
    _ = actor

    status_counts = await DiscoveryJobCRUD.count_by_status(db)
    queued = status_counts.get("queued", 0)
    running = status_counts.get("running", 0) + status_counts.get("claimed", 0)
    failed = status_counts.get("failed", 0)

    completed_runs = await DiscoveryRunCRUD.list(db, status="completed", limit=500)
    total_confirmed = sum(r.entries_confirmed for r in completed_runs)
    last_completed_at = completed_runs[0].completed_at if completed_runs else None

    enabled_schedules = len(await DiscoveryScheduleCRUD.list(db, enabled_only=True))

    apply_no_store_headers(response)
    return DiscoveryPipelineSummaryResponse(
        queued_jobs=queued,
        running_jobs=running,
        failed_jobs=failed,
        completed_runs_total=len(completed_runs),
        total_entries_confirmed=total_confirmed,
        last_completed_run_at=last_completed_at,
        enabled_schedules=enabled_schedules,
    )
