"""Discovery run endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryRunSyncCRUD,
    DiscoveryScheduleCRUD,
)
from atlas.domains.discovery.pipeline.runner import persist_discovery_artifacts
from atlas.domains.discovery.pipeline.runner_persistence import persist_discovery_results
from atlas.domains.discovery.run_creation import create_discovery_run_records, validate_issue_areas
from atlas.domains.discovery.schemas import (
    DiscoveryJobQueueItemResponse,
    DiscoveryJobQueueResponse,
    DiscoveryJobResponse,
    DiscoveryPipelineSummaryResponse,
    DiscoveryRunCancelResponse,
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
from atlas.models import DiscoveryRunCRUD, EntryCRUD, get_db_connection
from atlas.schemas import (
    DiscoveryRunCollectionResponse,
    DiscoveryRunResponse,
    DiscoveryRunStartRequest,
)

from .api_helpers import (
    _ensure_workspace_run_ownership,
    _entry_ids_from_artifacts,
    _entry_ids_from_run_summary,
    _entry_profile_path,
    _job_queue_item_to_response,
    _record_firehose_discovery_observations,
    _require_worker_job,
    _resolve_sync_destination,
    _run_to_response,
    _sync_entry_links,
    _sync_entry_visibility,
    _worker_job_to_response,
    get_db,
)
from .api_read_routes import (
    cancel_discovery_run,
    get_discovery_run,
    list_discovery_runs,
)
from .api_read_routes import router as read_router
from .api_submit_routes import (
    contribute_discovery_results,
    start_discovery_run,
    sync_discovery_run,
)
from .api_submit_routes import router as submit_router
from .api_worker_routes import (
    claim_discovery_job,
    complete_discovery_job,
    execute_scheduled_runs,
    fail_discovery_job,
    get_discovery_job,
    get_pipeline_summary,
    heartbeat_discovery_job,
    list_discovery_job_queue,
    release_worker_jobs,
)
from .api_worker_routes import router as worker_router

router = APIRouter()
router.routes.extend(submit_router.routes)
router.routes.extend(worker_router.routes)
router.routes.extend(read_router.routes)

__all__ = [
    "DiscoveryJobCRUD",
    "DiscoveryJobQueueItemResponse",
    "DiscoveryJobQueueResponse",
    "DiscoveryJobResponse",
    "DiscoveryPipelineSummaryResponse",
    "DiscoveryRunCRUD",
    "DiscoveryRunCancelResponse",
    "DiscoveryRunCollectionResponse",
    "DiscoveryRunResponse",
    "DiscoveryRunStartRequest",
    "DiscoveryRunSyncCRUD",
    "DiscoveryScheduleCRUD",
    "DiscoveryWorkerClaimRequest",
    "DiscoveryWorkerClaimResponse",
    "DiscoveryWorkerCompleteRequest",
    "DiscoveryWorkerFailRequest",
    "DiscoveryWorkerHeartbeatRequest",
    "DiscoveryWorkerJobResponse",
    "DiscoveryWorkerReleaseResponse",
    "EntryCRUD",
    "ScheduledRunResponse",
    "ScheduledRunResult",
    "_ensure_workspace_run_ownership",
    "_entry_ids_from_artifacts",
    "_entry_ids_from_run_summary",
    "_entry_profile_path",
    "_job_queue_item_to_response",
    "_record_firehose_discovery_observations",
    "_require_worker_job",
    "_resolve_sync_destination",
    "_run_to_response",
    "_sync_entry_links",
    "_sync_entry_visibility",
    "_worker_job_to_response",
    "cancel_discovery_run",
    "claim_discovery_job",
    "complete_discovery_job",
    "contribute_discovery_results",
    "create_discovery_run_records",
    "execute_scheduled_runs",
    "fail_discovery_job",
    "get_db",
    "get_db_connection",
    "get_discovery_job",
    "get_discovery_run",
    "get_pipeline_summary",
    "heartbeat_discovery_job",
    "list_discovery_job_queue",
    "list_discovery_runs",
    "persist_discovery_artifacts",
    "persist_discovery_results",
    "release_worker_jobs",
    "router",
    "start_discovery_run",
    "sync_discovery_run",
    "validate_issue_areas",
]
