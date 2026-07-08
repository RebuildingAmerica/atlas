"""Claim and payload helpers for the MCP Tasks extension."""

from __future__ import annotations

import json
from importlib import import_module
from typing import TYPE_CHECKING, Any

from mcp import types
from mcp.shared.exceptions import McpError

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp.data import _discovery_run_record

from .tasks_helpers import _job_to_task, _run_to_task
from .tasks_models import DraftGetTaskResult

if TYPE_CHECKING:
    import aiosqlite
    from mcp.server.lowlevel import Server as LowLevelServer

    from atlas.domains.discovery.models import DiscoveryRunModel


def _tasks_module() -> Any:
    return import_module("atlas.platform.mcp.tasks")


def _actor_claims_from_request_context(server: LowLevelServer) -> tuple[str | None, str | None]:
    """Return (org_id, user_id) from the JWT payload the auth middleware verified."""
    try:
        request = server.request_context.request
    except LookupError:
        return None, None

    if request is None:
        return None, None

    tasks_module = _tasks_module()
    payload = getattr(request.state, "mcp_auth_payload", None)
    string_claim = tasks_module._string_claim  # noqa: SLF001
    return string_claim(payload, "org_id"), string_claim(payload, "sub")


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
