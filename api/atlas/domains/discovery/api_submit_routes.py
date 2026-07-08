"""Discovery run endpoints."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from atlas_shared import (
    DiscoveryContributionRequest,
    DiscoveryContributionResponse,
    DiscoveryRunStatus,
    DiscoveryRunSyncRequest,
    DiscoveryRunSyncResponse,
    compute_artifact_hash,
)
from fastapi import APIRouter, Depends, Header, HTTPException, Response

from atlas.domains.access import AuthenticatedActor, require_actor_permission
from atlas.domains.access.capabilities import enforce_limit, require_capability
from atlas.domains.discovery.models import (
    DiscoveryRunSyncCRUD,
)
from atlas.domains.discovery.run_creation import create_discovery_run_records, validate_issue_areas
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import (
    DiscoveryRunResponse,
    DiscoveryRunStartRequest,
)

from .api_helpers import (
    _ensure_workspace_run_ownership,
    _entry_ids_from_artifacts,
    _entry_ids_from_run_summary,
    _record_firehose_discovery_observations,
    _resolve_sync_destination,
    _run_to_response,
    _sync_entry_links,
    get_db,
)

if TYPE_CHECKING:
    import aiosqlite


logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


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
    run = await create_discovery_run_records(db, req=req, settings=settings)
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
    validate_issue_areas(req.run.issue_areas)
    for ranked_entry in req.ranked_entries:
        validate_issue_areas(ranked_entry.entry.issue_areas)

    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query=req.run.location_query,
        state=req.run.state,
        issue_areas=req.run.issue_areas,
        research_goal=req.run.research_goal,
    )

    try:
        from atlas.domains.discovery import api as discovery_api

        confirmed_entry_ids, sources_persisted = await discovery_api.persist_discovery_results(
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
    validate_issue_areas(req.artifacts.manifest.run.issue_areas)
    for ranked_entry in req.artifacts.ranked_entries:
        validate_issue_areas(ranked_entry.entry.issue_areas)

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
        entry_ids = await _entry_ids_from_artifacts(db, req.artifacts.ranked_entries)
        if not entry_ids:
            entry_ids = _entry_ids_from_run_summary(existing_run)
        entry_links = await _sync_entry_links(
            db,
            entry_ids=entry_ids,
            workspace_id=sync_workspace_id,
            actor=actor,
        )
        await _record_firehose_discovery_observations(
            db,
            run_id=existing_sync.remote_run_id,
            org_id=sync_workspace_id or actor.org_id,
            entry_links=entry_links,
            issue_areas=req.artifacts.manifest.run.issue_areas,
        )
        apply_no_store_headers(response)
        return DiscoveryRunSyncResponse(
            run_id=existing_sync.remote_run_id,
            status=DiscoveryRunStatus(existing_run.status),
            sync_status="already_synced",
            entries_persisted=existing_run.entries_confirmed,
            sources_persisted=existing_run.sources_processed,
            duplicate=True,
            entry_links=entry_links,
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
        from atlas.domains.discovery import api as discovery_api

        confirmed_entry_ids, sources_persisted = await discovery_api.persist_discovery_artifacts(
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
        entry_links = await _sync_entry_links(
            db,
            entry_ids=confirmed_entry_ids,
            workspace_id=sync_workspace_id,
            actor=actor,
        )
        await _record_firehose_discovery_observations(
            db,
            run_id=remote_run_id,
            org_id=sync_workspace_id or actor.org_id,
            entry_links=entry_links,
            issue_areas=req.artifacts.manifest.run.issue_areas,
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
        entry_links=entry_links,
    )
