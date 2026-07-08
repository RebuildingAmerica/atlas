"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.responses import Response

from atlas.platform.mcp import tasks as tasks_module
from tests.support.mcp_tasks import (
    HTTP_NO_CONTENT,
    HTTP_OK,
    TASKS_EXTENSION,
)


class TestDraftTasksJsonRpcMiddleware:
    @pytest.mark.asyncio
    async def test_non_post_requests_pass_through(self) -> None:
        middleware = tasks_module.DraftTasksJsonRpcMiddleware(app=AsyncMock())
        request = MagicMock()
        request.method = "GET"
        call_next = AsyncMock(return_value=Response(status_code=HTTP_NO_CONTENT))

        response = await middleware.dispatch(request, call_next)

        assert response.status_code == HTTP_NO_CONTENT
        call_next.assert_awaited_once_with(request)

    @pytest.mark.asyncio
    async def test_invalid_json_passes_through(self) -> None:
        middleware = tasks_module.DraftTasksJsonRpcMiddleware(app=AsyncMock())
        request = MagicMock()
        request.method = "POST"
        request.json = AsyncMock(side_effect=ValueError)
        call_next = AsyncMock(return_value=Response(status_code=HTTP_NO_CONTENT))

        response = await middleware.dispatch(request, call_next)

        assert response.status_code == HTTP_NO_CONTENT
        call_next.assert_awaited_once_with(request)

    @pytest.mark.asyncio
    async def test_unhandled_jsonrpc_passes_through(self) -> None:
        middleware = tasks_module.DraftTasksJsonRpcMiddleware(app=AsyncMock())
        request = MagicMock()
        request.method = "POST"
        request.json = AsyncMock(return_value={"jsonrpc": "2.0", "method": "tools/list"})
        call_next = AsyncMock(return_value=Response(status_code=HTTP_NO_CONTENT))

        response = await middleware.dispatch(request, call_next)

        assert response.status_code == HTTP_NO_CONTENT
        call_next.assert_awaited_once_with(request)

    @pytest.mark.asyncio
    async def test_handled_jsonrpc_returns_json_response(self) -> None:
        middleware = tasks_module.DraftTasksJsonRpcMiddleware(app=AsyncMock())
        request = MagicMock()
        request.method = "POST"
        request.json = AsyncMock(
            return_value={"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {}}
        )
        call_next = AsyncMock()

        response = await middleware.dispatch(request, call_next)

        assert response.status_code == HTTP_OK
        assert json.loads(response.body) == {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"capabilities": {"extensions": {TASKS_EXTENSION: {}}}},
        }
        call_next.assert_not_awaited()
