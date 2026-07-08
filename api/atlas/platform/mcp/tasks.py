"""Compatibility barrel for the MCP Tasks extension."""

from __future__ import annotations

from atlas.domains.access.membership import verify_org_membership
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from atlas.domains.discovery.cost import record_cost
from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.run_creation import create_discovery_run_records
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import get_settings
from atlas.platform.database import db as db_util
from atlas.platform.mcp.auth_middleware import _string_claim
from atlas.platform.mcp.data import DatabaseSession
from atlas.platform.mcp.elicitation import declares_form_elicitation, log_elicitation_event
from atlas.platform.mcp.logging_support import log_operation
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor

from .tasks_handlers import (
    _handle_cancel_task,
    _handle_get_task,
    _handle_start_discovery_run,
    install_tasks_extension,
)
from .tasks_helpers import (
    _apply_discovery_run_preflight,
    _budget_exceeded_result,
    _create_discovery_run_task,
    _declares_tasks_extension,
    _derive_idempotency_key,
    _draft_result,
    _job_to_task,
    _missing_required_tasks_capability,
    _params_meta,
    _preflight_discovery_run_arguments,
    _progress_message,
    _require_tasks_extension,
    _resolve_task,
    _run_to_task,
    _tool_error,
)
from .tasks_jsonrpc import DraftTasksJsonRpcMiddleware, _handle_draft_tasks_jsonrpc
from .tasks_models import (
    _JOB_STATUS_TO_TASK_STATUS,
    _REQUIRED_TASKS_CAPABILITY_DATA,
    _START_DISCOVERY_RUN_TOOL,
    _TASK_POLL_INTERVAL_MS,
    _TASK_TTL_MS,
    _TOOLS_PAGE_SIZE,
    MISSING_REQUIRED_CLIENT_CAPABILITY,
    TASKS_EXTENSION,
    DiscoveryRunPreflight,
    DraftCreateTaskResult,
    DraftEmptyResult,
    DraftGetTaskResult,
    DraftResultRoot,
    DraftServerResult,
    DraftTask,
    McpHandlerResult,
)
from .tasks_payloads import (
    _actor_claims_from_request_context,
    _call_tool_result_payload,
    _detailed_task_result,
    _failed_tool_result_payload,
    _run_result_payload,
)

__all__ = [
    "MISSING_REQUIRED_CLIENT_CAPABILITY",
    "TASKS_EXTENSION",
    "_JOB_STATUS_TO_TASK_STATUS",
    "_REQUIRED_TASKS_CAPABILITY_DATA",
    "_START_DISCOVERY_RUN_TOOL",
    "_TASK_POLL_INTERVAL_MS",
    "_TASK_TTL_MS",
    "_TOOLS_PAGE_SIZE",
    "DatabaseSession",
    "DiscoveryJobCRUD",
    "DiscoveryRunCRUD",
    "DiscoveryRunPreflight",
    "DraftCreateTaskResult",
    "DraftEmptyResult",
    "DraftGetTaskResult",
    "DraftResultRoot",
    "DraftServerResult",
    "DraftTask",
    "DraftTasksJsonRpcMiddleware",
    "McpHandlerResult",
    "OrgDiscoveryBudgetCRUD",
    "OrgUsageEventCRUD",
    "OrgUsageEventRecord",
    "_actor_claims_from_request_context",
    "_apply_discovery_run_preflight",
    "_budget_exceeded_result",
    "_call_tool_result_payload",
    "_create_discovery_run_task",
    "_declares_tasks_extension",
    "_derive_idempotency_key",
    "_detailed_task_result",
    "_draft_result",
    "_failed_tool_result_payload",
    "_handle_cancel_task",
    "_handle_draft_tasks_jsonrpc",
    "_handle_get_task",
    "_handle_start_discovery_run",
    "_job_to_task",
    "_missing_required_tasks_capability",
    "_params_meta",
    "_preflight_discovery_run_arguments",
    "_progress_message",
    "_require_tasks_extension",
    "_resolve_task",
    "_run_result_payload",
    "_run_to_task",
    "_string_claim",
    "_tool_error",
    "create_discovery_run_records",
    "db_util",
    "declares_form_elicitation",
    "decode_cursor",
    "encode_cursor",
    "get_settings",
    "install_tasks_extension",
    "log_elicitation_event",
    "log_operation",
    "record_cost",
    "verify_org_membership",
]
