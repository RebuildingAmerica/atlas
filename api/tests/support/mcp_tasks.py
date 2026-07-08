"""Shared test helpers for MCP Tasks extension tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from mcp import types

from atlas.platform.mcp import tasks as tasks_module

ARBITRARY_TTL_MS = 30 * 60 * 1000
ARBITRARY_POLL_INTERVAL_MS = 5_000
HTTP_OK = 200
HTTP_NO_CONTENT = 204
TASKS_EXTENSION = "io.modelcontextprotocol/tasks"


def _tasks_meta() -> dict[str, Any]:
    return {
        "io.modelcontextprotocol/clientCapabilities": {
            "extensions": {
                TASKS_EXTENSION: {},
            },
        },
    }


def _tasks_and_elicitation_meta() -> dict[str, Any]:
    meta = _tasks_meta()
    meta["io.modelcontextprotocol/clientCapabilities"]["elicitation"] = {"form": {}}
    return meta


def _call_tool_request(name: str, arguments: dict[str, Any] | None = None) -> types.CallToolRequest:
    return types.CallToolRequest.model_validate(
        {
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments,
                "_meta": _tasks_meta(),
            },
        }
    )


def _call_tool_request_with_meta(
    name: str,
    arguments: dict[str, Any] | None,
    meta: dict[str, Any],
) -> types.CallToolRequest:
    return types.CallToolRequest.model_validate(
        {
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments,
                "_meta": meta,
            },
        }
    )


def _get_task_request(task_id: str) -> types.GetTaskRequest:
    return types.GetTaskRequest.model_validate(
        {"method": "tasks/get", "params": {"taskId": task_id, "_meta": _tasks_meta()}}
    )


def _cancel_task_request(task_id: str) -> types.CancelTaskRequest:
    return types.CancelTaskRequest.model_validate(
        {"method": "tasks/cancel", "params": {"taskId": task_id, "_meta": _tasks_meta()}}
    )


def _handler_for(mcp: Any, request_type: type) -> Any:
    """Return the low-level request handler registered for a request type."""
    return mcp._mcp_server.request_handlers[request_type]  # noqa: SLF001


async def _handle_draft_tasks_jsonrpc(payload: object) -> dict[str, Any] | None:
    """Call the draft JSON-RPC shim under test."""
    return await tasks_module._handle_draft_tasks_jsonrpc(payload)  # noqa: SLF001


def _init_options(mcp: Any) -> Any:
    """Return the low-level server's initialization options."""
    return mcp._mcp_server.create_initialization_options()  # noqa: SLF001


def _start_request(**overrides: Any) -> dict[str, Any]:
    payload = {
        "location_query": "Kansas City, MO",
        "state": "MO",
        "issue_areas": ["housing_affordability"],
        "research_goal": "landscape_scan",
    }
    payload.update(overrides)
    return payload


class FakeElicitationSession:
    def __init__(self, result: types.ElicitResult) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def elicit_form(
        self,
        *,
        message: str,
        requestedSchema: dict[str, Any],  # noqa: N803
        related_request_id: object,
    ) -> types.ElicitResult:
        self.calls.append(
            {
                "message": message,
                "requestedSchema": requestedSchema,
                "related_request_id": related_request_id,
            }
        )
        return self.result


class FakePreflightServer:
    def __init__(self, result: types.ElicitResult) -> None:
        self.session = FakeElicitationSession(result)

    @property
    def request_context(self) -> Any:
        return MagicMock(session=self.session, request_id="req_1")


class FakePreflightServerWithoutContext:
    @property
    def request_context(self) -> Any:
        raise LookupError
