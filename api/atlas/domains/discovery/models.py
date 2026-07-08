"""Public discovery models and CRUD entry points."""

from __future__ import annotations

from atlas.platform.database import db

from .models_job_core import (
    DiscoveryJobCRUDCore,
    DiscoveryJobInput,
    DiscoveryJobModel,
    DiscoveryJobQueueItemModel,
    _job_input_payload,
    _retry_backoff_at,
    _row_to_discovery_job,
    _row_to_discovery_job_queue_item,
)
from .models_job_lifecycle import DiscoveryJobCRUDLifecycle
from .models_job_queries import DiscoveryJobCRUDQueries
from .models_run_core import DiscoveryRunCRUDCore, DiscoveryRunModel, _row_to_discovery_run
from .models_run_ops import DiscoveryRunCRUDOps
from .models_run_sync import DiscoveryRunSyncCRUD, DiscoveryRunSyncModel, _row_to_discovery_run_sync
from .models_schedule import (
    DiscoveryScheduleCRUD,
    DiscoveryScheduleModel,
    _row_to_discovery_schedule,
)


class DiscoveryRunCRUD(DiscoveryRunCRUDCore, DiscoveryRunCRUDOps):
    """Public discovery run CRUD."""


class DiscoveryJobCRUD(DiscoveryJobCRUDCore, DiscoveryJobCRUDLifecycle, DiscoveryJobCRUDQueries):
    """Public discovery job CRUD."""


__all__ = [
    "DiscoveryJobCRUD",
    "DiscoveryJobInput",
    "DiscoveryJobModel",
    "DiscoveryJobQueueItemModel",
    "DiscoveryRunCRUD",
    "DiscoveryRunModel",
    "DiscoveryRunSyncCRUD",
    "DiscoveryRunSyncModel",
    "DiscoveryScheduleCRUD",
    "DiscoveryScheduleModel",
    "_job_input_payload",
    "_retry_backoff_at",
    "_row_to_discovery_job",
    "_row_to_discovery_job_queue_item",
    "_row_to_discovery_run",
    "_row_to_discovery_run_sync",
    "_row_to_discovery_schedule",
    "db",
]
