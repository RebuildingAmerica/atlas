"""MCP Tasks extension: async execution for the ``start_discovery_run`` tool.

Atlas's 12 read-only MCP tools are all fast lookups, so none of them need an
async task handle. ``start_discovery_run`` is the first write/compute tool on
the MCP surface — it can take minutes (LLM extraction + browser research) — so
it returns a ``CreateTaskResult`` instead of blocking, and callers poll
``tasks/get`` or call ``tasks/cancel``.

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
from typing import TYPE_CHECKING, Any, Literal, cast

from fastapi import HTTPException
from mcp import types
from mcp.shared.exceptions import McpError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

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
from atlas.platform.mcp.logging_support import log_operation
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor
from atlas.schemas import DiscoveryRunStartRequest

if TYPE_CHECKING:
    import aiosqlite
    from mcp.server.fastmcp import FastMCP
    from mcp.server.lowlevel import Server as LowLevelServer
    from starlette.requests import Request

    from atlas.domains.discovery.models import DiscoveryJobModel, DiscoveryRunModel
    from atlas.platform.config import Settings

__all__ = ["TASKS_EXTENSION", "DraftTasksJsonRpcMiddleware", "install_tasks_extension"]

TASKS_EXTENSION = "io.modelcontextprotocol/tasks"
MISSING_REQUIRED_CLIENT_CAPABILITY = -32003

_TASK_TTL_MS = 30 * 60 * 1000
"""30 minutes: enough to cover queueing, backoff, and a full pipeline run."""

_TASK_POLL_INTERVAL_MS = 5_000
"""5 seconds: matches the LLM/browser-research latency of a discovery run."""

_TOOLS_PAGE_SIZE = 50
"""Generous default: today's 13 tools always fit on page one. Real pagination
kicks in once the tool count actually exceeds this, without changing behavior
for MCP clients that don't loop on nextCursor."""

DraftTaskStatus = Literal["working", "input_required", "completed", "cancelled", "failed"]

_JOB_STATUS_TO_TASK_STATUS: dict[str, DraftTaskStatus] = {
    "queued": "working",
    "claimed": "working",
    "running": "working",
    "completed": "completed",
    # Discovery failures are tool-level outcomes, not JSON-RPC protocol errors.
    "failed": "completed",
    "cancelled": "cancelled",
}

_REQUIRED_TASKS_CAPABILITY_DATA: dict[str, Any] = {
    "requiredCapabilities": {"extensions": {TASKS_EXTENSION: {}}},
}

_START_DISCOVERY_RUN_TOOL = types.Tool(
    name="start_discovery_run",
    description=(
        "Trigger an Atlas discovery run for a place and issue areas. Requires "
        "the MCP Tasks extension and returns a task handle immediately; poll "
        "tasks/get until it completes. Metered against the calling org's "
        "monthly discovery budget."
    ),
    inputSchema=DiscoveryRunStartRequest.model_json_schema(),
)


class DraftTask(BaseModel):
    """Task shape from the draft ``io.modelcontextprotocol/tasks`` extension."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    task_id: str = Field(alias="taskId")
    status: DraftTaskStatus
    status_message: str | None = Field(default=None, alias="statusMessage")
    created_at: datetime = Field(alias="createdAt")
    last_updated_at: datetime = Field(alias="lastUpdatedAt")
    ttl_ms: int | None = Field(alias="ttlMs")
    poll_interval_ms: int | None = Field(default=None, alias="pollIntervalMs")


class DraftCreateTaskResult(BaseModel):
    """Draft CreateTaskResult: a flat result discriminator plus task fields."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    result_type: Literal["task"] = Field(default="task", alias="resultType")
    task: DraftTask
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

    def model_dump(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        """Serialize as ``Result & Task`` instead of nesting under ``task``."""
        dump_kwargs = dict(kwargs)
        dump_kwargs.setdefault("by_alias", True)
        data = self.task.model_dump(*args, **dump_kwargs)
        data["resultType"] = self.result_type
        if self.result is not None:
            data["result"] = self.result
        if self.error is not None:
            data["error"] = self.error
        return data


class DraftGetTaskResult(DraftTask):
    """Draft tasks/get result with status-specific payload fields."""

    result_type: Literal["complete"] = Field(default="complete", alias="resultType")
    input_requests: dict[str, Any] | None = Field(default=None, alias="inputRequests")
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class DraftEmptyResult(BaseModel):
    """Draft empty acknowledgement result."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    result_type: Literal["complete"] = Field(default="complete", alias="resultType")


DraftResultRoot = DraftCreateTaskResult | DraftGetTaskResult | DraftEmptyResult


class DraftServerResult:
    """Small response wrapper compatible with MCP session serialization."""

    def __init__(self, root: DraftResultRoot) -> None:
        self.root = root

    def model_dump(self, **kwargs: Any) -> dict[str, Any]:
        """Return the wrapped draft result in JSON-RPC ``result`` shape."""
        dump_kwargs = dict(kwargs)
        dump_kwargs.setdefault("by_alias", True)
        return self.root.model_dump(**dump_kwargs)


McpHandlerResult = types.ServerResult | DraftServerResult


def _draft_result(root: DraftResultRoot) -> DraftServerResult:
    """Wrap a draft result for FastMCP's low-level request responder."""
    return DraftServerResult(root)


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
    status = _JOB_STATUS_TO_TASK_STATUS.get(job.status, "working")
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
    status = _JOB_STATUS_TO_TASK_STATUS.get(run.status, "working")
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


async def _resolve_task(conn: aiosqlite.Connection, task_id: str) -> DraftTask:
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
) -> McpHandlerResult:
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
) -> McpHandlerResult:
    """Handle a draft Tasks ``start_discovery_run`` tool call."""
    _require_tasks_extension(req.params)

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


def _call_tool_result_payload(result: types.CallToolResult) -> dict[str, Any]:
    """Serialize a CallToolResult for inlining in draft ``tasks/get``."""
    return result.model_dump(by_alias=True, mode="json", exclude_none=True)


def _run_result_payload(run: DiscoveryRunModel) -> dict[str, Any]:
    """Return the successful tool result payload for a completed discovery run."""
    record = _discovery_run_record(run)
    return _call_tool_result_payload(
        types.CallToolResult(
            content=[types.TextContent(type="text", text=json.dumps(record, indent=2))],
            structuredContent=record,
            isError=False,
        )
    )


def _failed_tool_result_payload(message: str | None) -> dict[str, Any]:
    """Return a completed tool-level error payload for a failed discovery run."""
    return _call_tool_result_payload(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=message or "Discovery run failed.",
                )
            ],
            isError=True,
        )
    )


async def _detailed_task_result(conn: aiosqlite.Connection, task_id: str) -> DraftGetTaskResult:
    """Resolve a task id to the draft ``tasks/get`` result shape."""
    job = await DiscoveryJobCRUD.get_by_id(conn, task_id)
    if job is not None:
        task = _job_to_task(job)
        payload: dict[str, Any] | None = None
        if job.status == "completed":
            run = await DiscoveryRunCRUD.get_by_id(conn, job.run_id)
            if run is None:
                raise McpError(
                    types.ErrorData(code=types.INVALID_PARAMS, message=f"Unknown task: {task_id}")
                )
            payload = _run_result_payload(run)
        elif job.status == "failed":
            payload = _failed_tool_result_payload(job.error_message)
        return DraftGetTaskResult(**task.model_dump(), result=payload)

    run = await DiscoveryRunCRUD.get_by_id(conn, task_id)
    if run is not None:
        task = _run_to_task(run)
        payload = None
        if run.status == "completed":
            payload = _run_result_payload(run)
        elif run.status == "failed":
            payload = _failed_tool_result_payload(run.error_message)
        return DraftGetTaskResult(**task.model_dump(), result=payload)

    raise McpError(types.ErrorData(code=types.INVALID_PARAMS, message=f"Unknown task: {task_id}"))


async def _handle_get_task(req: types.GetTaskRequest) -> McpHandlerResult:
    """Handle ``tasks/get``."""
    _require_tasks_extension(req.params)
    await log_operation(
        logger="atlas.mcp.tasks",
        level="debug",
        message="tasks/get",
        taskId=req.params.taskId,
    )
    settings = get_settings()
    async with DatabaseSession(settings.database_url) as conn:
        task = await _detailed_task_result(conn, req.params.taskId)
    return _draft_result(task)


async def _handle_cancel_task(req: types.CancelTaskRequest) -> McpHandlerResult:
    """Handle ``tasks/cancel``. Only jobs are cancellable, not inline-mode runs."""
    _require_tasks_extension(req.params)
    await log_operation(
        logger="atlas.mcp.tasks",
        level="info",
        message="tasks/cancel",
        taskId=req.params.taskId,
    )
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

    return _draft_result(DraftEmptyResult())


def _jsonrpc_success(request_id: object, result: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON-RPC success response."""
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _jsonrpc_error(request_id: object, error: types.ErrorData) -> dict[str, Any]:
    """Build a JSON-RPC error response."""
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": error.model_dump(by_alias=True, mode="json", exclude_none=True),
    }


def _draft_jsonrpc_request(payload: object) -> tuple[dict[str, Any], str] | None:
    """Return the JSON-RPC payload and method when a request can be inspected."""
    if not isinstance(payload, dict):
        return None

    method = payload.get("method")
    if not isinstance(method, str):
        return None

    return payload, method


def _task_id_from_update_params(params: dict[str, Any]) -> str:
    """Return a valid task id from ``tasks/update`` params."""
    task_id = params.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        raise McpError(
            types.ErrorData(code=types.INVALID_PARAMS, message="Invalid or missing taskId")
        )
    return task_id


def _input_responses_from_update_params(params: dict[str, Any]) -> dict[str, Any]:
    """Return valid input responses from ``tasks/update`` params."""
    input_responses = params.get("inputResponses")
    if not isinstance(input_responses, dict):
        raise McpError(types.ErrorData(code=types.INVALID_PARAMS, message="Invalid inputResponses"))
    return input_responses


async def _handle_draft_tasks_jsonrpc(payload: object) -> dict[str, Any] | None:
    """Handle draft-only Tasks JSON-RPC methods before SDK parsing.

    The installed MCP SDK knows an older task surface and cannot parse
    ``tasks/update`` or ``server/discover``. Atlas intercepts only those draft
    methods here; all SDK-supported methods continue through FastMCP.
    """
    request = _draft_jsonrpc_request(payload)
    if request is None:
        return None

    payload, method = request
    request_id = payload.get("id")
    if method == "server/discover":
        return _jsonrpc_success(
            request_id,
            {"capabilities": {"extensions": {TASKS_EXTENSION: {}}}},
        )

    if method != "tasks/update":
        return None

    params = payload.get("params")
    if not isinstance(params, dict):
        return _jsonrpc_error(
            request_id,
            types.ErrorData(code=types.INVALID_PARAMS, message="Invalid tasks/update params"),
        )

    try:
        _require_tasks_extension(params)
        task_id = _task_id_from_update_params(params)
        _input_responses_from_update_params(params)

        settings = get_settings()
        async with DatabaseSession(settings.database_url) as conn:
            await _resolve_task(conn, task_id)
    except McpError as exc:
        return _jsonrpc_error(request_id, exc.error)

    return _jsonrpc_success(request_id, DraftEmptyResult().model_dump(by_alias=True))


class DraftTasksJsonRpcMiddleware(BaseHTTPMiddleware):
    """Intercept draft Tasks methods that the current MCP SDK cannot parse."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method != "POST":
            return await call_next(request)

        try:
            payload = await request.json()
        except Exception:
            return await call_next(request)

        response = await _handle_draft_tasks_jsonrpc(payload)
        if response is None:
            return await call_next(request)
        return JSONResponse(response)


def install_tasks_extension(mcp: FastMCP) -> None:
    """Wire the MCP Tasks extension onto a FastMCP server instance.

    Adds ``start_discovery_run`` plus ``tasks/get`` and ``tasks/cancel``
    handlers. Registered directly on the low-level
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

    async def handle_call_tool(req: types.CallToolRequest) -> McpHandlerResult:
        tool_name = req.params.name
        await log_operation(
            logger="atlas.mcp.tools",
            level="info",
            message="tool call started",
            tool=tool_name,
        )

        result: McpHandlerResult
        if tool_name != _START_DISCOVERY_RUN_TOOL.name:
            result = await original_call_tool_handler(req)
        else:
            result = await _handle_start_discovery_run(server, req)

        is_error = isinstance(result.root, types.CallToolResult) and result.root.isError
        await log_operation(
            logger="atlas.mcp.tools",
            level="error" if is_error else "info",
            message="tool call failed" if is_error else "tool call succeeded",
            tool=tool_name,
        )
        return result

    server.request_handlers[types.CallToolRequest] = cast("Any", handle_call_tool)

    server.request_handlers[types.GetTaskRequest] = cast("Any", _handle_get_task)
    server.request_handlers[types.CancelTaskRequest] = cast("Any", _handle_cancel_task)
