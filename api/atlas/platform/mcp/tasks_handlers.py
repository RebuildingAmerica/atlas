"""MCP Tasks request handlers and installation hook."""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any, cast

from mcp import types
from mcp.shared.exceptions import McpError

from .tasks_helpers import _draft_result, _require_tasks_extension, _tool_error
from .tasks_models import DraftEmptyResult, McpHandlerResult

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP
    from mcp.server.lowlevel import Server as LowLevelServer


def _tasks_module() -> Any:
    return import_module("atlas.platform.mcp.tasks")


async def _handle_start_discovery_run(
    server: LowLevelServer, req: types.CallToolRequest
) -> McpHandlerResult:
    """Handle a draft Tasks ``start_discovery_run`` tool call."""
    _require_tasks_extension(req.params)

    tasks_module = _tasks_module()
    org_id, user_id = tasks_module._actor_claims_from_request_context(server)  # noqa: SLF001
    if org_id is None or user_id is None:
        return _tool_error("start_discovery_run requires an authenticated org context.")

    arguments = await tasks_module._preflight_discovery_run_arguments(  # noqa: SLF001
        server,
        params=req.params,
        arguments=req.params.arguments or {},
    )
    if isinstance(arguments, types.ServerResult):
        return arguments

    settings = tasks_module.get_settings()
    async with tasks_module.DatabaseSession(settings.database_url) as conn:
        result = await tasks_module._create_discovery_run_task(  # noqa: SLF001
            conn,
            org_id=org_id,
            user_id=user_id,
            settings=settings,
            arguments=arguments,
        )
    return cast("McpHandlerResult", result)


async def _handle_get_task(req: types.GetTaskRequest) -> McpHandlerResult:
    """Handle ``tasks/get``."""
    tasks_module = _tasks_module()
    _require_tasks_extension(req.params)
    await tasks_module.log_operation(
        logger="atlas.mcp.tasks",
        level="debug",
        message="tasks/get",
        taskId=req.params.taskId,
    )
    settings = tasks_module.get_settings()
    async with tasks_module.DatabaseSession(settings.database_url) as conn:
        task = await tasks_module._detailed_task_result(conn, req.params.taskId)  # noqa: SLF001
    return _draft_result(task)


async def _handle_cancel_task(req: types.CancelTaskRequest) -> McpHandlerResult:
    """Handle ``tasks/cancel``. Only jobs are cancellable, not inline-mode runs."""
    tasks_module = _tasks_module()
    _require_tasks_extension(req.params)
    await tasks_module.log_operation(
        logger="atlas.mcp.tasks",
        level="info",
        message="tasks/cancel",
        taskId=req.params.taskId,
    )
    settings = tasks_module.get_settings()
    async with tasks_module.DatabaseSession(settings.database_url) as conn:
        job = await tasks_module.DiscoveryJobCRUD.get_by_id(conn, req.params.taskId)
        if job is None:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Task not found or not cancellable: {req.params.taskId}",
                )
            )
        await tasks_module.DiscoveryJobCRUD.cancel(conn, req.params.taskId)

    return _draft_result(DraftEmptyResult())


def install_tasks_extension(mcp: FastMCP) -> None:
    """Wire the MCP Tasks extension onto a FastMCP server instance."""
    server = mcp._mcp_server  # noqa: SLF001
    tasks_module = _tasks_module()
    start_tool = tasks_module._START_DISCOVERY_RUN_TOOL  # noqa: SLF001

    original_list_tools = mcp.list_tools

    async def list_tools_with_start_discovery_run() -> list[types.Tool]:
        tools = await original_list_tools()
        return [*tools, start_tool]

    mcp.list_tools = list_tools_with_start_discovery_run  # type: ignore[method-assign]

    original_list_tools_handler = server.request_handlers[types.ListToolsRequest]

    async def handle_list_tools(req: types.ListToolsRequest | None) -> types.ServerResult:
        result = await original_list_tools_handler(req)
        list_result = cast("types.ListToolsResult", result.root)
        tools = [*list_result.tools, start_tool]

        if req is None:
            return types.ServerResult(types.ListToolsResult(tools=tools, nextCursor=None))

        cursor = req.params.cursor if req.params is not None else None
        try:
            offset = tasks_module.decode_cursor(cursor)
        except ValueError as exc:
            raise McpError(types.ErrorData(code=types.INVALID_PARAMS, message=str(exc))) from exc

        page_size = tasks_module._TOOLS_PAGE_SIZE  # noqa: SLF001
        page = tools[offset : offset + page_size]
        next_offset = offset + page_size
        next_cursor = tasks_module.encode_cursor(next_offset) if next_offset < len(tools) else None

        return types.ServerResult(types.ListToolsResult(tools=page, nextCursor=next_cursor))

    server.request_handlers[types.ListToolsRequest] = handle_list_tools

    original_call_tool_handler = server.request_handlers[types.CallToolRequest]

    async def handle_call_tool(req: types.CallToolRequest) -> McpHandlerResult:
        tool_name = req.params.name
        await tasks_module.log_operation(
            logger="atlas.mcp.tools",
            level="info",
            message="tool call started",
            tool=tool_name,
        )

        result: McpHandlerResult
        if tool_name != start_tool.name:
            result = await original_call_tool_handler(req)
        else:
            result = await _handle_start_discovery_run(server, req)

        is_error = isinstance(result.root, types.CallToolResult) and result.root.isError
        await tasks_module.log_operation(
            logger="atlas.mcp.tools",
            level="error" if is_error else "info",
            message="tool call failed" if is_error else "tool call succeeded",
            tool=tool_name,
        )
        return result

    server.request_handlers[types.CallToolRequest] = cast("Any", handle_call_tool)
    server.request_handlers[types.GetTaskRequest] = cast("Any", _handle_get_task)
    server.request_handlers[types.CancelTaskRequest] = cast("Any", _handle_cancel_task)
