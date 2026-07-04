"""Discovery run endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from atlas_shared import (
    DiscoveryContributionRequest,
    DiscoveryContributionResponse,
    DiscoveryRunStatus,
    DiscoveryRunSyncRequest,
    DiscoveryRunSyncResponse,
    compute_artifact_hash,
)
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.access.capabilities import enforce_limit, require_capability
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryRunSyncCRUD,
    DiscoveryScheduleCRUD,
)
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
    persist_discovery_artifacts,
    persist_discovery_results,
    run_discovery_pipeline_for_run,
)
from atlas.domains.discovery.schemas import (
    DiscoveryJobQueueItemResponse,
    DiscoveryJobQueueResponse,
    DiscoveryJobResponse,
    DiscoveryPipelineSummaryResponse,
    DiscoveryRunCancelResponse,
    ScheduledRunResponse,
    ScheduledRunResult,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import db as db_manager
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import (
    DiscoveryRunCollectionResponse,
    DiscoveryRunResponse,
    DiscoveryRunStartRequest,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.discovery.models import DiscoveryJobQueueItemModel, DiscoveryRunModel

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]

SYNC_UPLOAD_TARGETS = frozenset({"public", "workspace"})


def _validate_issue_areas(issue_areas: list[str]) -> None:
    """Raise when any requested issue area falls outside the Atlas taxonomy."""
    invalid_issue_areas = [
        issue_area for issue_area in issue_areas if issue_area not in ALL_ISSUE_SLUGS
    ]
    if invalid_issue_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue area(s): {', '.join(invalid_issue_areas)}",
        )


def _resolve_sync_destination(
    *,
    upload_target: str | None,
    workspace_id: str | None,
    actor: AuthenticatedActor,
) -> tuple[str | None, str | None]:
    """Validate and normalize Scout run-sync destination headers."""
    if not isinstance(upload_target, str):
        upload_target = None
    if not isinstance(workspace_id, str):
        workspace_id = None

    if upload_target is None:
        return None, None

    normalized_target = upload_target.strip().lower()
    if normalized_target not in SYNC_UPLOAD_TARGETS:
        raise HTTPException(status_code=400, detail="Invalid Scout upload target")

    if normalized_target == "public":
        return normalized_target, None

    resolved_workspace_id = workspace_id or actor.org_id
    if not resolved_workspace_id:
        raise HTTPException(status_code=400, detail="Workspace upload target requires workspace id")
    if actor.org_id is None and not actor.is_local:
        raise HTTPException(status_code=403, detail="Workspace upload target requires org context")
    if actor.org_id is not None and actor.org_id != resolved_workspace_id:
        raise HTTPException(status_code=403, detail="Workspace upload target does not match actor")
    return normalized_target, resolved_workspace_id


async def _ensure_workspace_run_ownership(
    db: aiosqlite.Connection,
    *,
    run_id: str,
    workspace_id: str | None,
    actor: AuthenticatedActor,
) -> None:
    """Attach a synced discovery run to a workspace as private owned work."""
    if workspace_id is None:
        return

    ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
    if ownership is not None:
        if ownership.org_id != workspace_id:
            raise HTTPException(
                status_code=409, detail="Discovery run belongs to another workspace"
            )
        return

    await OwnershipCRUD.create_ownership(
        db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id=workspace_id,
        visibility="private",
        created_by=actor.user_id,
    )


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


@router.post(
    "",
    response_model=DiscoveryRunResponse,
    status_code=202,
    summary="Start a discovery run",
    description="Start an Atlas discovery pipeline run for a place and set of issue areas.",
    operation_id="createDiscoveryRun",
    response_description="The accepted discovery run.",
    tags=["discovery-runs"],
)
async def start_discovery_run(
    req: DiscoveryRunStartRequest,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    settings: Settings = Depends(get_settings),
    db: aiosqlite.Connection = Depends(get_db),
    response: Response = Response(),
    _cap: None = Depends(require_capability("research.run")),
    _run_limit: int | None = Depends(enforce_limit("research_runs_per_month")),
) -> DiscoveryRunResponse:
    """
    Start a discovery run for a location and issue areas.

    Returns immediately with run ID. The pipeline runs asynchronously
    via the durable job worker, or inline if discovery_inline is set.
    """
    _ = actor
    _validate_issue_areas(req.issue_areas)

    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query=req.location_query,
        state=req.state,
        issue_areas=req.issue_areas,
        research_goal=req.research_goal,
    )

    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=500, detail="Failed to create discovery run")

    if settings.discovery_inline:
        pipeline_job = DiscoveryPipelineJob(
            run_id=run_id,
            location_query=req.location_query,
            state=req.state,
            issue_areas=req.issue_areas,
            research_goal=req.research_goal,
        )
        pipeline_credentials = DiscoveryPipelineCredentials(
            search_api_key=settings.search_api_key,
            anthropic_api_key=settings.anthropic_api_key,
        )
        await run_discovery_pipeline_for_run(
            database_url=settings.database_url,
            job=pipeline_job,
            credentials=pipeline_credentials,
            settings=settings,
        )
        run = await DiscoveryRunCRUD.get_by_id(db, run_id)
        if not run:
            raise HTTPException(status_code=500, detail="Failed to refresh discovery run")
    else:
        await DiscoveryJobCRUD.create(db, run_id=run_id)

    apply_no_store_headers(response)
    return _run_to_response(run)


@router.post(
    "/contributions",
    response_model=DiscoveryContributionResponse,
    status_code=201,
    summary="Ingest contributed discovery results",
    description=(
        "Persist a discovery payload produced by an external runner such as Scout, using the "
        "same shared discovery models Atlas service uses internally."
    ),
    operation_id="createDiscoveryContribution",
    response_description="The persisted Atlas run summary.",
    tags=["discovery-runs"],
)
async def contribute_discovery_results(
    req: DiscoveryContributionRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
    _run_limit: int | None = Depends(enforce_limit("research_runs_per_month")),
) -> DiscoveryContributionResponse:
    """Persist a full discovery payload contributed by a local runner."""
    _ = actor
    _validate_issue_areas(req.run.issue_areas)
    for ranked_entry in req.ranked_entries:
        _validate_issue_areas(ranked_entry.entry.issue_areas)

    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query=req.run.location_query,
        state=req.run.state,
        issue_areas=req.run.issue_areas,
        research_goal=req.run.research_goal,
    )

    try:
        confirmed_entry_ids, sources_persisted = await persist_discovery_results(
            db,
            run_id=run_id,
            ranked_entries=req.ranked_entries,
            sources=req.sources,
            stats=req.stats,
        )
    except Exception as exc:
        await DiscoveryRunCRUD.fail(db, run_id, str(exc))
        raise

    apply_no_store_headers(response)
    return DiscoveryContributionResponse(
        run_id=run_id,
        status=req.stats.status,
        entries_persisted=len(confirmed_entry_ids),
        sources_persisted=sources_persisted,
    )


@router.post(
    "/syncs",
    response_model=DiscoveryRunSyncResponse,
    status_code=201,
    summary="Sync a local discovery run bundle",
    description=(
        "Replay a canonical local discovery bundle into Atlas using an authenticated, idempotent "
        "run-sync workflow."
    ),
    operation_id="createDiscoveryRunSync",
    response_description="The result of syncing the local run bundle.",
    tags=["discovery-runs"],
)
async def sync_discovery_run(  # noqa: PLR0913
    req: DiscoveryRunSyncRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
    x_atlas_upload_target: str | None = Header(None),
    x_atlas_workspace_id: str | None = Header(None),
    _cap: None = Depends(require_capability("research.run")),
    _run_limit: int | None = Depends(enforce_limit("research_runs_per_month")),
) -> DiscoveryRunSyncResponse:
    """Persist a full discovery artifact bundle from an offline-capable runner."""
    _sync_target, sync_workspace_id = _resolve_sync_destination(
        upload_target=x_atlas_upload_target,
        workspace_id=x_atlas_workspace_id,
        actor=actor,
    )
    _validate_issue_areas(req.artifacts.manifest.run.issue_areas)
    for ranked_entry in req.artifacts.ranked_entries:
        _validate_issue_areas(ranked_entry.entry.issue_areas)

    sync_info = req.artifacts.manifest.sync
    if sync_info is None or not sync_info.local_run_id:
        raise HTTPException(
            status_code=400, detail="artifacts.manifest.sync.local_run_id is required"
        )

    artifact_hash = sync_info.artifact_hash or compute_artifact_hash(req.artifacts)
    existing_sync = await DiscoveryRunSyncCRUD.get_by_identity(
        db,
        local_run_id=sync_info.local_run_id,
        artifact_hash=artifact_hash,
    )
    if existing_sync is not None:
        existing_run = await DiscoveryRunCRUD.get_by_id(db, existing_sync.remote_run_id)
        if existing_run is None:
            raise HTTPException(
                status_code=500, detail="Synced discovery run could not be reloaded"
            )
        await _ensure_workspace_run_ownership(
            db,
            run_id=existing_sync.remote_run_id,
            workspace_id=sync_workspace_id,
            actor=actor,
        )
        apply_no_store_headers(response)
        return DiscoveryRunSyncResponse(
            run_id=existing_sync.remote_run_id,
            status=DiscoveryRunStatus(existing_run.status),
            sync_status="already_synced",
            entries_persisted=existing_run.entries_confirmed,
            sources_persisted=existing_run.sources_processed,
            duplicate=True,
        )

    remote_run_id = sync_info.remote_run_id
    if remote_run_id:
        existing_run = await DiscoveryRunCRUD.get_by_id(db, remote_run_id)
        if existing_run is None:
            raise HTTPException(status_code=400, detail="Referenced remote_run_id does not exist")
    else:
        remote_run_id = await DiscoveryRunCRUD.create(
            db,
            location_query=req.artifacts.manifest.run.location_query,
            state=req.artifacts.manifest.run.state,
            issue_areas=req.artifacts.manifest.run.issue_areas,
            research_goal=req.artifacts.manifest.run.research_goal,
        )

    try:
        confirmed_entry_ids, sources_persisted = await persist_discovery_artifacts(
            db,
            run_id=remote_run_id,
            artifacts=req.artifacts,
        )
        await _ensure_workspace_run_ownership(
            db,
            run_id=remote_run_id,
            workspace_id=sync_workspace_id,
            actor=actor,
        )
        await DiscoveryRunSyncCRUD.create(
            db,
            local_run_id=sync_info.local_run_id,
            artifact_hash=artifact_hash,
            remote_run_id=remote_run_id,
            actor_user_id=actor.user_id,
            actor_email=actor.email,
            sync_status="synced",
        )
    except Exception as exc:
        await DiscoveryRunCRUD.fail(db, remote_run_id, str(exc))
        raise

    apply_no_store_headers(response)
    return DiscoveryRunSyncResponse(
        run_id=remote_run_id,
        status=req.artifacts.stats.status,
        sync_status="synced",
        entries_persisted=len(confirmed_entry_ids),
        sources_persisted=sources_persisted,
        duplicate=False,
    )


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
        progress=job.progress,
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


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


@router.get(
    "",
    response_model=DiscoveryRunCollectionResponse,
    summary="List discovery runs",
    description="List Atlas discovery pipeline runs with optional state and status filters.",
    operation_id="listDiscoveryRuns",
    response_description="A paginated collection of discovery runs.",
    tags=["discovery-runs"],
)
async def list_discovery_runs(  # noqa: PLR0913
    response: Response,
    *,
    state: str | None = Query(None, min_length=2, max_length=2),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunCollectionResponse:
    """
    List discovery runs with optional filtering.

    Query Parameters:
    - state: filter by state
    - status: running, completed, or failed
    - limit: results per page (default: 50, max: 500)
    - cursor: pagination cursor (default: 0)
    """
    try:
        _ = actor
        offset = max(int(cursor), 0) if cursor is not None else 0
        runs = await DiscoveryRunCRUD.list(
            db,
            state=state,
            status=status,
            limit=limit,
            offset=offset,
        )
        total = await DiscoveryRunCRUD.count(db, state=state, status=status)
        items = [_run_to_response(r).model_dump(mode="json") for r in runs]
        next_cursor = str(offset + limit) if offset + limit < total else None
        apply_no_store_headers(response)
        return DiscoveryRunCollectionResponse(items=items, total=total, next_cursor=next_cursor)
    except Exception:
        logger.exception(
            "Failed to list discovery runs",
            extra={
                "actor_auth_type": actor.auth_type,
                "actor_email": actor.email,
                "actor_user_id": actor.user_id,
                "cursor": cursor,
                "limit": limit,
                "state": state,
                "status": status,
            },
        )
        raise


@router.get(
    "/{run_id}",
    response_model=DiscoveryRunResponse,
    summary="Get a discovery run",
    description="Return one Atlas discovery run by ID.",
    operation_id="getDiscoveryRun",
    response_description="The requested discovery run.",
    tags=["discovery-runs"],
)
async def get_discovery_run(
    run_id: str,
    response: Response = Response(),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "read")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunResponse:
    """Get a discovery run by ID."""
    _ = actor
    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")
    apply_no_store_headers(response)
    return _run_to_response(run)


@router.post(
    "/{run_id}/cancel",
    response_model=DiscoveryRunCancelResponse,
    summary="Cancel a discovery run",
    description="Cancel every queued, claimed, or running job belonging to a discovery run.",
    operation_id="cancelDiscoveryRun",
    tags=["discovery-runs"],
)
async def cancel_discovery_run(
    run_id: str,
    response: Response = Response(),
    actor: AuthenticatedActor = Depends(require_actor_permission("discovery", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> DiscoveryRunCancelResponse:
    """Cancel a discovery run's outstanding jobs.

    Returns the number of non-terminal jobs that were moved to ``cancelled``;
    already-finished jobs are left untouched. Returns 404 if the run is unknown.
    """
    _ = actor
    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Discovery run not found")
    cancelled = await DiscoveryJobCRUD.cancel_run_jobs(db, run_id)
    apply_no_store_headers(response)
    return DiscoveryRunCancelResponse(run_id=run_id, jobs_cancelled=cancelled)


def _job_queue_item_to_response(job: DiscoveryJobQueueItemModel) -> DiscoveryJobQueueItemResponse:
    """Convert a discovery job queue item into an API response."""
    return DiscoveryJobQueueItemResponse(
        id=job.id,
        run_id=job.run_id,
        status=job.status,
        progress=job.progress,
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        location_query=job.location_query,
        state=job.state,
        issue_areas=job.issue_areas,
        claimed_by=job.claimed_by,
        claimed_until=job.claimed_until,
        next_attempt_at=job.next_attempt_at,
    )


def _run_to_response(run: DiscoveryRunModel) -> DiscoveryRunResponse:
    """Convert DiscoveryRunModel to DiscoveryRunResponse."""
    return DiscoveryRunResponse(
        id=run.id,
        location_query=run.location_query,
        state=run.state,
        research_goal=run.research_goal,
        issue_areas=run.issue_areas,
        queries_generated=run.queries_generated,
        sources_fetched=run.sources_fetched,
        sources_processed=run.sources_processed,
        entries_extracted=run.entries_extracted,
        entries_after_dedup=run.entries_after_dedup,
        entries_confirmed=run.entries_confirmed,
        started_at=run.started_at,
        completed_at=run.completed_at,
        status=run.status,
        error_message=run.error_message,
        created_at=run.created_at,
        research_summary=run.research_summary,
    )
