"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp import types
from starlette.responses import Response

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp import tasks as tasks_module
from tests.support.mcp_tasks import (
    HTTP_NO_CONTENT,
    HTTP_OK,
    TASKS_EXTENSION,
    _tasks_meta,
)


class TestDraftTasksJsonRpcMiddleware:
    @pytest.mark.asyncio
    async def test_jsonrpc_request_validation_returns_none_for_uninspectable_payloads(self) -> None:
        assert await tasks_module._handle_draft_tasks_jsonrpc(["not", "a", "dict"]) is None
        assert await tasks_module._handle_draft_tasks_jsonrpc({"method": 123}) is None
        assert await tasks_module._handle_draft_tasks_jsonrpc({"method": "tools/list"}) is None

    @pytest.mark.asyncio
    async def test_tasks_update_rejects_invalid_params(self) -> None:
        response = await tasks_module._handle_draft_tasks_jsonrpc(
            {"jsonrpc": "2.0", "id": "bad", "method": "tasks/update", "params": []}
        )

        assert response is not None
        assert response["error"]["code"] == types.INVALID_PARAMS
        assert response["error"]["message"] == "Invalid tasks/update params"

    @pytest.mark.asyncio
    async def test_tasks_update_rejects_missing_task_fields(self) -> None:
        response = await tasks_module._handle_draft_tasks_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": "missing-task",
                "method": "tasks/update",
                "params": {"_meta": _tasks_meta(), "inputResponses": {}},
            }
        )

        assert response is not None
        assert response["error"]["code"] == types.INVALID_PARAMS
        assert response["error"]["message"] == "Invalid or missing taskId"

        response = await tasks_module._handle_draft_tasks_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": "missing-input",
                "method": "tasks/update",
                "params": {"_meta": _tasks_meta(), "taskId": "task_1"},
            }
        )

        assert response is not None
        assert response["error"]["code"] == types.INVALID_PARAMS
        assert response["error"]["message"] == "Invalid inputResponses"

    @pytest.mark.asyncio
    async def test_tasks_update_returns_empty_result_for_known_task(
        self, test_db: object, test_settings: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="Kansas City, MO", state="MO", issue_areas=["housing"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        monkeypatch.setattr(tasks_module, "get_settings", lambda: test_settings)

        response = await tasks_module._handle_draft_tasks_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": "known-task",
                "method": "tasks/update",
                "params": {"_meta": _tasks_meta(), "taskId": job_id, "inputResponses": {}},
            }
        )

        assert response == {
            "jsonrpc": "2.0",
            "id": "known-task",
            "result": {"resultType": "complete"},
        }

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
