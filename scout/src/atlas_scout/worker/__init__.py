"""Atlas worker process helpers for Scout.

Public API facade over the worker/ package: local state file persistence
(state), the Atlas worker HTTP API client (api_client), claimed-job
execution (job), and the foreground loop plus start/stop/status
orchestration (lifecycle).
"""

from __future__ import annotations

from atlas_scout.worker.api_client import (
    _worker_api_token,
    _worker_claim_job,
    _worker_complete_job,
    _worker_fail_job,
    _worker_heartbeat_job,
    _worker_post,
)
from atlas_scout.worker.errors import WorkerJobError
from atlas_scout.worker.job import (
    _worker_heartbeat_loop,
    _worker_job_direct_urls,
    _worker_job_execution_mode,
    _worker_job_issues,
    _worker_process_job,
)
from atlas_scout.worker.lifecycle import (
    _spawn_worker_process,
    _worker_run_internal,
    _worker_start,
    _worker_status,
    _worker_stop,
)
from atlas_scout.worker.state import (
    WORKER_STATE_PATH,
    _now_iso,
    _read_worker_state,
    _resolve_optional_worker_search_key,
    _worker_state_running,
    _write_stopped_worker_state,
    _write_worker_state,
)

__all__ = [
    "WORKER_STATE_PATH",
    "WorkerJobError",
    "_now_iso",
    "_read_worker_state",
    "_resolve_optional_worker_search_key",
    "_spawn_worker_process",
    "_worker_api_token",
    "_worker_claim_job",
    "_worker_complete_job",
    "_worker_fail_job",
    "_worker_heartbeat_job",
    "_worker_heartbeat_loop",
    "_worker_job_direct_urls",
    "_worker_job_execution_mode",
    "_worker_job_issues",
    "_worker_post",
    "_worker_process_job",
    "_worker_run_internal",
    "_worker_start",
    "_worker_state_running",
    "_worker_status",
    "_worker_stop",
    "_write_stopped_worker_state",
    "_write_worker_state",
]
