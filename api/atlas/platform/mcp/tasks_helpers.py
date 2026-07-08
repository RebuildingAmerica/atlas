"""Core helpers for the MCP Tasks extension."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from importlib import import_module
from typing import TYPE_CHECKING, Any, cast

from fastapi import HTTPException
from mcp import types
from mcp.shared.exceptions import McpError
from pydantic import ValidationError

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from atlas.domains.discovery.cost import record_cost
from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.run_creation import create_discovery_run_records
from atlas.models import DiscoveryRunCRUD
from atlas.platform.database import db as db_util
from atlas.schemas import DiscoveryRunStartRequest

from .tasks_models import (
    _JOB_STATUS_TO_TASK_STATUS,
    _REQUIRED_TASKS_CAPABILITY_DATA,
    _TASK_POLL_INTERVAL_MS,
    _TASK_TTL_MS,
    MISSING_REQUIRED_CLIENT_CAPABILITY,
    TASKS_EXTENSION,
    DiscoveryRunPreflight,
    DraftCreateTaskResult,
    DraftResultRoot,
    DraftServerResult,
    DraftTask,
    DraftTaskStatus,
    McpHandlerResult,
)

if TYPE_CHECKING:
    import aiosqlite
    from mcp.server.lowlevel import Server as LowLevelServer

    from atlas.domains.discovery.models import DiscoveryJobModel, DiscoveryRunModel
    from atlas.platform.config import Settings


def _tasks_module() -> Any:
    return import_module("atlas.platform.mcp.tasks")


def _draft_result(root: DraftResultRoot) -> DraftServerResult:
    """Wrap a draft result for FastMCP's low-level request responder."""
    tasks_module = _tasks_module()
    return cast("DraftServerResult", tasks_module.DraftServerResult(root))


def _missing_required_tasks_capability() -> McpError:
    """Return the draft extension's missing-capability JSON-RPC error."""
    return McpError(
        types.ErrorData(
            code=MISSING_REQUIRED_CLIENT_CAPABILITY,
            message="Missing required client capability",
            data=_REQUIRED_TASKS_CAPABILITY_DATA,
        )
    )


def _progress_message(progress: dict[str, Any] | None) -> str | None:
    """Return a human-readable status message from a job's progress blob."""
    if not isinstance(progress, dict):
        return None
    message = progress.get("message")
    return message if isinstance(message, str) else None


def _job_to_task(job: DiscoveryJobModel) -> DraftTask:
    """Map a discovery job's state onto an MCP Task."""
    status = cast("DraftTaskStatus", _JOB_STATUS_TO_TASK_STATUS.get(job.status, "working"))
    status_message = (
        job.error_message if job.status == "failed" else _progress_message(job.progress)
    )
    created_at = datetime.fromisoformat(job.created_at)
    last_updated_at = datetime.fromisoformat(job.completed_at) if job.completed_at else created_at
    return DraftTask(
        task_id=job.id,
        status=status,
        status_message=status_message,
        created_at=created_at,
        last_updated_at=last_updated_at,
        ttl_ms=_TASK_TTL_MS,
        poll_interval_ms=_TASK_POLL_INTERVAL_MS,
    )


def _run_to_task(run: DiscoveryRunModel) -> DraftTask:
    """Map a discovery run's state onto an MCP Task.

    Used only when ``settings.discovery_inline`` ran the pipeline synchronously
    and no job was ever created to poll.
    """
    status = cast("DraftTaskStatus", _JOB_STATUS_TO_TASK_STATUS.get(run.status, "working"))
    status_message = run.error_message if run.status == "failed" else None
    created_at = datetime.fromisoformat(run.started_at)
    last_updated_at = datetime.fromisoformat(run.completed_at) if run.completed_at else created_at
    return DraftTask(
        task_id=run.id,
        status=status,
        status_message=status_message,
        created_at=created_at,
        last_updated_at=last_updated_at,
        ttl_ms=_TASK_TTL_MS,
        poll_interval_ms=_TASK_POLL_INTERVAL_MS,
    )


def _tool_error(message: str) -> types.ServerResult:
    """Build an isError CallToolResult carrying a human-readable message."""
    return types.ServerResult(
        types.CallToolResult(content=[types.TextContent(type="text", text=message)], isError=True)
    )


def _budget_exceeded_result(exc: HTTPException) -> types.ServerResult:
    """Build an isError CallToolResult from a budget-exceeded HTTPException."""
    detail: dict[str, Any] = exc.detail if isinstance(exc.detail, dict) else {}
    message = (
        f"Discovery budget exhausted for org {detail.get('org_id')} in {detail.get('month')}: "
        f"{detail.get('used_runs')}/{detail.get('monthly_run_limit')} runs used this month."
    )
    return types.ServerResult(
        types.CallToolResult(
            content=[types.TextContent(type="text", text=message)],
            structuredContent=detail,
            isError=True,
        )
    )


def _derive_idempotency_key(org_id: str, req: DiscoveryRunStartRequest) -> str:
    """Derive a server-side idempotency key for an MCP-triggered discovery run."""
    fingerprint = "|".join(
        [
            req.location_query,
            req.state,
            ",".join(sorted(req.issue_areas)),
            req.research_goal,
        ]
    )
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    return f"mcp:{org_id}:{digest}:{today}"


def _params_meta(params: object) -> object | None:
    """Return request ``_meta`` from SDK params or raw JSON params."""
    if isinstance(params, dict):
        return params.get("_meta")
    return getattr(params, "meta", None)


def _declares_tasks_extension(meta: object | None) -> bool:
    """Return whether request metadata declares the draft Tasks extension."""
    if meta is None:
        return False

    if hasattr(meta, "model_dump"):
        meta = meta.model_dump(by_alias=True, exclude_none=True)
    if not isinstance(meta, dict):
        return False

    capabilities = meta.get("io.modelcontextprotocol/clientCapabilities")
    if not isinstance(capabilities, dict):
        return False

    extensions = capabilities.get("extensions")
    return isinstance(extensions, dict) and isinstance(extensions.get(TASKS_EXTENSION), dict)


def _require_tasks_extension(params: object) -> None:
    """Raise when a draft task method lacks per-request Tasks capability."""
    if not _declares_tasks_extension(_params_meta(params)):
        raise _missing_required_tasks_capability()


def _apply_discovery_run_preflight(
    arguments: dict[str, Any],
    preflight: DiscoveryRunPreflight,
) -> dict[str, Any]:
    """Return discovery-run arguments confirmed or amended by form preflight."""
    confirmed = {**arguments}
    if preflight.location_query and preflight.location_query.strip():
        confirmed["location_query"] = preflight.location_query.strip()
    if preflight.state and preflight.state.strip():
        confirmed["state"] = preflight.state.strip().upper()
    if preflight.issue_areas:
        confirmed["issue_areas"] = [issue_area.strip() for issue_area in preflight.issue_areas]
    if preflight.research_goal and preflight.research_goal.strip():
        confirmed["research_goal"] = preflight.research_goal.strip()
    if preflight.search_depth and preflight.search_depth.strip():
        confirmed["search_depth"] = preflight.search_depth.strip()
    return confirmed


async def _preflight_discovery_run_arguments(
    server: LowLevelServer,
    *,
    params: object,
    arguments: dict[str, Any],
) -> dict[str, Any] | types.ServerResult:
    """Confirm a budgeted discovery run before reserving budget or creating jobs."""
    tasks_module = _tasks_module()
    if not tasks_module.declares_form_elicitation(_params_meta(params)):
        await tasks_module.log_elicitation_event(
            interaction="discovery_run_preflight",
            mode="form",
            action="unsupported",
        )
        return arguments

    try:
        request_context = server.request_context
    except LookupError:
        await tasks_module.log_elicitation_event(
            interaction="discovery_run_preflight",
            mode="form",
            action="unavailable",
        )
        return arguments

    await tasks_module.log_elicitation_event(
        interaction="discovery_run_preflight",
        mode="form",
        action="requested",
    )
    result = await request_context.session.elicit_form(
        message="Confirm this discovery run before using a monthly research run.",
        requestedSchema=DiscoveryRunPreflight.model_json_schema(),
        related_request_id=request_context.request_id,
    )
    if result.action != "accept":
        await tasks_module.log_elicitation_event(
            interaction="discovery_run_preflight",
            mode="form",
            action=result.action,
        )
        return _tool_error("Discovery run not started.")

    try:
        preflight = DiscoveryRunPreflight.model_validate(result.content)
    except ValidationError as exc:
        await tasks_module.log_elicitation_event(
            interaction="discovery_run_preflight",
            mode="form",
            action="invalid_response",
        )
        return _tool_error(f"Invalid discovery run preflight response: {exc}")

    if not preflight.confirm_run:
        await tasks_module.log_elicitation_event(
            interaction="discovery_run_preflight",
            mode="form",
            action="decline",
        )
        return _tool_error("Discovery run not started.")
    await tasks_module.log_elicitation_event(
        interaction="discovery_run_preflight",
        mode="form",
        action="accept",
    )
    return _apply_discovery_run_preflight(arguments, preflight)


async def _resolve_task(conn: aiosqlite.Connection, task_id: str) -> DraftTask:
    """Resolve a task id to its current state."""
    job = await DiscoveryJobCRUD.get_by_id(conn, task_id)
    if job is not None:
        return _job_to_task(job)

    run = await DiscoveryRunCRUD.get_by_id(conn, task_id)
    if run is not None:
        return _run_to_task(run)

    raise McpError(types.ErrorData(code=types.INVALID_PARAMS, message=f"Unknown task: {task_id}"))


async def _create_discovery_run_task(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    user_id: str,
    settings: Settings,
    arguments: dict[str, Any],
) -> McpHandlerResult:
    """Validate, budget-gate, and create a discovery run for an MCP caller."""
    tasks_module = _tasks_module()
    try:
        tool_req = DiscoveryRunStartRequest.model_validate(arguments)
    except ValidationError as exc:
        return _tool_error(f"Invalid start_discovery_run arguments: {exc}")

    if settings.auth_membership_verification_url:
        membership = await tasks_module.verify_org_membership(user_id, org_id, settings)
        if membership is None:
            return _tool_error("Not a member of the specified organization.")

    idempotency_key = _derive_idempotency_key(org_id, tool_req)
    existing_job = await DiscoveryJobCRUD.get_by_idempotency_key(conn, idempotency_key)
    if existing_job is not None:
        return _draft_result(DraftCreateTaskResult(task=_job_to_task(existing_job)))

    try:
        await OrgDiscoveryBudgetCRUD.reserve_run(
            conn, org_id=org_id, month=datetime.now(UTC).strftime("%Y-%m")
        )
    except HTTPException as exc:
        return _budget_exceeded_result(exc)

    run = await create_discovery_run_records(
        conn, req=tool_req, settings=settings, idempotency_key=idempotency_key
    )
    job = await DiscoveryJobCRUD.get_by_run_id(conn, run.id)

    await record_cost(
        conn, run_id=run.id, kind="reservation", provider="mcp", units=1.0, estimated_cost=0.0
    )
    await OrgUsageEventCRUD.record(
        conn,
        OrgUsageEventRecord(
            org_id=org_id,
            actor_id=user_id,
            event_type="api_call",
            resource_type="api",
            resource_id="start_discovery_run",
            metadata_json=db_util.encode_json(
                {
                    "auth_type": "oauth_jwt",
                    "surface": "mcp",
                    "location_query": tool_req.location_query,
                    "state": tool_req.state,
                    "issue_areas": tool_req.issue_areas,
                    "run_id": run.id,
                }
            ),
        ),
    )

    task = _job_to_task(job) if job is not None else _run_to_task(run)
    return _draft_result(DraftCreateTaskResult(task=task))
