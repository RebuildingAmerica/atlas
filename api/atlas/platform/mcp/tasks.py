"""MCP Tasks extension: async execution for the ``start_discovery_run`` tool.

Atlas's 12 read-only MCP tools are all fast lookups, so none of them need an
async task handle. ``start_discovery_run`` is the first write/compute tool on
the MCP surface — it can take minutes (LLM extraction + browser research) — so
it returns a ``CreateTaskResult`` instead of blocking, and callers poll
``tasks/get``/``tasks/result`` or call ``tasks/cancel``.

FastMCP's own tool-call pipeline (``FastMCP.call_tool`` ->
``ToolManager.call_tool(..., convert_result=True)``) normalizes every tool
return value into content blocks/structured content and has no path for
``CreateTaskResult``, so this tool is registered directly on the low-level
``Server.request_handlers`` dict rather than via ``@mcp.tool()``.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

from fastapi import HTTPException
from mcp import types
from mcp.shared.exceptions import McpError
from pydantic import ValidationError

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
from atlas.platform.mcp.data import DatabaseSession, _discovery_run_record
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor
from atlas.schemas import DiscoveryRunStartRequest

if TYPE_CHECKING:
    import aiosqlite
    from mcp.server.fastmcp import FastMCP
    from mcp.server.lowlevel import Server as LowLevelServer

    from atlas.domains.discovery.models import DiscoveryJobModel, DiscoveryRunModel
    from atlas.platform.config import Settings

__all__ = ["install_tasks_extension"]

_TASK_TTL_MS = 30 * 60 * 1000
"""30 minutes: enough to cover queueing, backoff, and a full pipeline run."""

_TASK_POLL_INTERVAL_MS = 5_000
"""5 seconds: matches the LLM/browser-research latency of a discovery run."""

_TOOLS_PAGE_SIZE = 50
"""Generous default: today's 13 tools always fit on page one. Real pagination
kicks in once the tool count actually exceeds this, without changing behavior
for MCP clients that don't loop on nextCursor."""

_JOB_STATUS_TO_TASK_STATUS: dict[str, types.TaskStatus] = {
    "queued": "working",
    "claimed": "working",
    "running": "working",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "cancelled",
}

_START_DISCOVERY_RUN_TOOL = types.Tool(
    name="start_discovery_run",
    description=(
        "Trigger an Atlas discovery run for a place and issue areas. Requires "
        "task-augmented execution: pass `task` in the tool-call params and poll "
        "tasks/get, or use list_discovery_runs/get_discovery_run to check "
        "manually. Metered against the calling org's monthly discovery budget."
    ),
    inputSchema=DiscoveryRunStartRequest.model_json_schema(),
    execution=types.ToolExecution(taskSupport="required"),
)


def _progress_message(progress: dict[str, Any] | None) -> str | None:
    """Return a human-readable status message from a job's progress blob."""
    if not isinstance(progress, dict):
        return None
    message = progress.get("message")
    return message if isinstance(message, str) else None


def _job_to_task(job: DiscoveryJobModel) -> types.Task:
    """Map a discovery job's state onto an MCP Task."""
    status = _JOB_STATUS_TO_TASK_STATUS.get(job.status, "working")
    status_message = job.error_message if status == "failed" else _progress_message(job.progress)
    created_at = datetime.fromisoformat(job.created_at)
    last_updated_at = datetime.fromisoformat(job.completed_at) if job.completed_at else created_at
    return types.Task(
        taskId=job.id,
        status=status,
        statusMessage=status_message,
        createdAt=created_at,
        lastUpdatedAt=last_updated_at,
        ttl=_TASK_TTL_MS,
        pollInterval=_TASK_POLL_INTERVAL_MS,
    )


def _run_to_task(run: DiscoveryRunModel) -> types.Task:
    """Map a discovery run's state onto an MCP Task.

    Used only when ``settings.discovery_inline`` ran the pipeline synchronously
    and no job was ever created to poll.
    """
    status = _JOB_STATUS_TO_TASK_STATUS.get(run.status, "working")
    status_message = run.error_message if status == "failed" else None
    created_at = datetime.fromisoformat(run.started_at)
    last_updated_at = datetime.fromisoformat(run.completed_at) if run.completed_at else created_at
    return types.Task(
        taskId=run.id,
        status=status,
        statusMessage=status_message,
        createdAt=created_at,
        lastUpdatedAt=last_updated_at,
        ttl=_TASK_TTL_MS,
        pollInterval=_TASK_POLL_INTERVAL_MS,
    )


def _tool_error(message: str) -> types.ServerResult:
    """Build an isError CallToolResult carrying a human-readable message."""
    return types.ServerResult(
        types.CallToolResult(content=[types.TextContent(type="text", text=message)], isError=True)
    )


def _budget_exceeded_result(exc: HTTPException) -> types.ServerResult:
    """Build an isError CallToolResult from a budget-exceeded HTTPException.

    Carries the same structured fields as the REST 409 (``org_id``, ``month``,
    ``monthly_run_limit``, ``used_runs``, ``remaining_runs``) so a client
    handling one handles the other identically.
    """
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
    """Derive a server-side idempotency key for an MCP-triggered discovery run.

    Never accepts a client-supplied nonce: a caller could mint a fresh one
    every call to defeat dedup. The key is stable for the same org and target
    within a UTC day, mirroring the ``sched:{id}:{day}`` pattern already used
    by scheduled discovery runs.
    """
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


async def _resolve_task(conn: aiosqlite.Connection, task_id: str) -> types.Task:
    """Resolve a task id to its current state.

    A task id is normally a job id. It falls back to a run id when
    ``discovery_inline`` ran the pipeline synchronously and no job exists.
    """
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
) -> types.ServerResult:
    """Validate, budget-gate, and create a discovery run for an MCP caller."""
    try:
        tool_req = DiscoveryRunStartRequest.model_validate(arguments)
    except ValidationError as exc:
        return _tool_error(f"Invalid start_discovery_run arguments: {exc}")

    if settings.auth_membership_verification_url:
        membership = await verify_org_membership(user_id, org_id, settings)
        if membership is None:
            return _tool_error("Not a member of the specified organization.")

    idempotency_key = _derive_idempotency_key(org_id, tool_req)
    existing_job = await DiscoveryJobCRUD.get_by_idempotency_key(conn, idempotency_key)
    if existing_job is not None:
        return types.ServerResult(types.CreateTaskResult(task=_job_to_task(existing_job)))

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
    return types.ServerResult(types.CreateTaskResult(task=task))


def _actor_claims_from_request_context(server: LowLevelServer) -> tuple[str | None, str | None]:
    """Return (org_id, user_id) from the JWT payload the auth middleware verified.

    Returns (None, None) outside a request context, when no HTTP request is
    attached (e.g. a non-ASGI transport), or when no payload was stashed
    (auth disabled in local/dev mode).
    """
    try:
        request = server.request_context.request
    except LookupError:
        return None, None

    if request is None:
        return None, None

    payload = getattr(request.state, "mcp_auth_payload", None)
    return _string_claim(payload, "org_id"), _string_claim(payload, "sub")


async def _handle_start_discovery_run(
    server: LowLevelServer, req: types.CallToolRequest
) -> types.ServerResult:
    """Handle a task-augmented ``start_discovery_run`` tool call."""
    if req.params.task is None:
        return _tool_error(
            "start_discovery_run requires task-augmented execution. Declare the "
            "MCP tasks capability and include `task` in the tool-call params; "
            "use list_discovery_runs/get_discovery_run to poll manually otherwise."
        )

    org_id, user_id = _actor_claims_from_request_context(server)
    if org_id is None or user_id is None:
        return _tool_error("start_discovery_run requires an authenticated org context.")

    settings = get_settings()
    async with DatabaseSession(settings.database_url) as conn:
        return await _create_discovery_run_task(
            conn,
            org_id=org_id,
            user_id=user_id,
            settings=settings,
            arguments=req.params.arguments or {},
        )


async def _handle_get_task(req: types.GetTaskRequest) -> types.ServerResult:
    """Handle ``tasks/get``."""
    settings = get_settings()
    async with DatabaseSession(settings.database_url) as conn:
        task = await _resolve_task(conn, req.params.taskId)
    return types.ServerResult(
        types.GetTaskResult(
            taskId=task.taskId,
            status=task.status,
            statusMessage=task.statusMessage,
            createdAt=task.createdAt,
            lastUpdatedAt=task.lastUpdatedAt,
            ttl=task.ttl,
            pollInterval=task.pollInterval,
        )
    )


async def _handle_get_task_result(req: types.GetTaskPayloadRequest) -> types.ServerResult:
    """Handle ``tasks/result``, returning the same shape as ``get_discovery_run``."""
    settings = get_settings()
    async with DatabaseSession(settings.database_url) as conn:
        job = await DiscoveryJobCRUD.get_by_id(conn, req.params.taskId)
        run_id = job.run_id if job is not None else req.params.taskId
        run = await DiscoveryRunCRUD.get_by_id(conn, run_id)
        if run is None:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS, message=f"Unknown task: {req.params.taskId}"
                )
            )
        record = _discovery_run_record(run)

    return types.ServerResult(
        types.CallToolResult(
            content=[types.TextContent(type="text", text=json.dumps(record, indent=2))],
            structuredContent=record,
            isError=False,
        )
    )


async def _handle_cancel_task(req: types.CancelTaskRequest) -> types.ServerResult:
    """Handle ``tasks/cancel``. Only jobs are cancellable, not inline-mode runs."""
    settings = get_settings()
    async with DatabaseSession(settings.database_url) as conn:
        job = await DiscoveryJobCRUD.get_by_id(conn, req.params.taskId)
        if job is None:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Task not found or not cancellable: {req.params.taskId}",
                )
            )
        await DiscoveryJobCRUD.cancel(conn, req.params.taskId)
        job = await DiscoveryJobCRUD.get_by_id(conn, req.params.taskId)

    assert job is not None, "job existed moments ago in the same request"
    task = _job_to_task(job)
    return types.ServerResult(
        types.CancelTaskResult(
            taskId=task.taskId,
            status=task.status,
            statusMessage=task.statusMessage,
            createdAt=task.createdAt,
            lastUpdatedAt=task.lastUpdatedAt,
            ttl=task.ttl,
            pollInterval=task.pollInterval,
        )
    )


def install_tasks_extension(mcp: FastMCP) -> None:
    """Wire the MCP Tasks extension onto a FastMCP server instance.

    Adds ``start_discovery_run`` plus ``tasks/get``, ``tasks/result``, and
    ``tasks/cancel`` handlers. Registered directly on the low-level
    ``Server.request_handlers`` dict — see the module docstring for why.
    """
    server = mcp._mcp_server  # noqa: SLF001

    original_list_tools = mcp.list_tools

    async def list_tools_with_start_discovery_run() -> list[types.Tool]:
        tools = await original_list_tools()
        return [*tools, _START_DISCOVERY_RUN_TOOL]

    mcp.list_tools = list_tools_with_start_discovery_run  # type: ignore[method-assign]

    original_list_tools_handler = server.request_handlers[types.ListToolsRequest]

    async def handle_list_tools(req: types.ListToolsRequest | None) -> types.ServerResult:
        result = await original_list_tools_handler(req)
        list_result = cast("types.ListToolsResult", result.root)
        tools = [*list_result.tools, _START_DISCOVERY_RUN_TOOL]

        if req is None:
            # _get_cached_tool_definition calls this handler with req=None to
            # refresh its tool cache — always give it everything, unpaginated,
            # so every tool (not just page one) ends up cached.
            return types.ServerResult(types.ListToolsResult(tools=tools, nextCursor=None))

        cursor = req.params.cursor if req.params is not None else None
        try:
            offset = decode_cursor(cursor)
        except ValueError as exc:
            raise McpError(types.ErrorData(code=types.INVALID_PARAMS, message=str(exc))) from exc

        page = tools[offset : offset + _TOOLS_PAGE_SIZE]
        next_offset = offset + _TOOLS_PAGE_SIZE
        next_cursor = encode_cursor(next_offset) if next_offset < len(tools) else None

        return types.ServerResult(types.ListToolsResult(tools=page, nextCursor=next_cursor))

    server.request_handlers[types.ListToolsRequest] = handle_list_tools

    original_call_tool_handler = server.request_handlers[types.CallToolRequest]

    async def handle_call_tool(req: types.CallToolRequest) -> types.ServerResult:
        if req.params.name != _START_DISCOVERY_RUN_TOOL.name:
            return await original_call_tool_handler(req)
        return await _handle_start_discovery_run(server, req)

    server.request_handlers[types.CallToolRequest] = handle_call_tool

    server.request_handlers[types.GetTaskRequest] = _handle_get_task
    server.request_handlers[types.GetTaskPayloadRequest] = _handle_get_task_result
    server.request_handlers[types.CancelTaskRequest] = _handle_cancel_task

    original_create_initialization_options = server.create_initialization_options

    def create_initialization_options_with_tasks(*args: Any, **kwargs: Any) -> Any:
        options = original_create_initialization_options(*args, **kwargs)
        options.capabilities.tasks = types.ServerTasksCapability(
            cancel=types.TasksCancelCapability(),
            requests=types.ServerTasksRequestsCapability(
                tools=types.TasksToolsCapability(call=types.TasksCallCapability())
            ),
        )
        return options

    server.create_initialization_options = (  # type: ignore[method-assign]
        create_initialization_options_with_tasks
    )
