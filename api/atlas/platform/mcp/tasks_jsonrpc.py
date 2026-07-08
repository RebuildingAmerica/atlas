"""Compatibility wrappers for the draft MCP Tasks JSON-RPC surface."""

from __future__ import annotations

from importlib import import_module
from typing import Any

from mcp import types
from mcp.shared.exceptions import McpError
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from .tasks_helpers import _require_tasks_extension, _resolve_task
from .tasks_models import TASKS_EXTENSION, DraftEmptyResult

__all__ = ["DraftTasksJsonRpcMiddleware", "_handle_draft_tasks_jsonrpc"]


def _tasks_module() -> Any:
    return import_module("atlas.platform.mcp.tasks")


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
    """Handle draft-only Tasks JSON-RPC methods before SDK parsing."""
    tasks_module = _tasks_module()
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

        settings = tasks_module.get_settings()
        async with tasks_module.DatabaseSession(settings.database_url) as conn:
            await _resolve_task(conn, task_id)
    except McpError as exc:
        return _jsonrpc_error(request_id, exc.error)

    return _jsonrpc_success(request_id, DraftEmptyResult().model_dump(by_alias=True))


class DraftTasksJsonRpcMiddleware(BaseHTTPMiddleware):
    """Intercept draft Tasks methods that the current MCP SDK cannot parse."""

    async def dispatch(self, request: Any, call_next: RequestResponseEndpoint) -> Response:
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
