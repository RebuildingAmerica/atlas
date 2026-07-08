"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from mcp import types

from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp import tasks as tasks_module
from atlas.platform.mcp.server import build_mcp
from tests.support.mcp_tasks import (
    _cancel_task_request,
    _get_task_request,
    _handler_for,
)

if TYPE_CHECKING:
    from atlas.config import Settings


class TestLoggingIntegration:
    @pytest.mark.asyncio
    async def test_call_tool_logs_start_and_success(self, test_settings: Settings) -> None:
        with patch("atlas.platform.mcp.server.get_settings", return_value=test_settings):
            mcp = build_mcp()
            handler = _handler_for(mcp, types.CallToolRequest)
            request = types.CallToolRequest(
                method="tools/call",
                params=types.CallToolRequestParams(name="search_entities", arguments={"limit": 1}),
            )
            with patch.object(tasks_module, "log_operation", new=AsyncMock()) as log_mock:
                result = await handler(request)

        assert result.root.isError is False
        assert log_mock.await_count >= 2  # noqa: PLR2004
        levels = [call.kwargs["level"] for call in log_mock.await_args_list]
        assert "error" not in levels

    @pytest.mark.asyncio
    async def test_call_tool_logs_error_for_failed_call(self, test_settings: Settings) -> None:
        with patch("atlas.platform.mcp.server.get_settings", return_value=test_settings):
            mcp = build_mcp()
            handler = _handler_for(mcp, types.CallToolRequest)
            request = types.CallToolRequest(
                method="tools/call",
                params=types.CallToolRequestParams(name="get_entity", arguments={"entity_id": "x"}),
            )
            with patch.object(tasks_module, "log_operation", new=AsyncMock()) as log_mock:
                result = await handler(request)

        assert result.root.isError is True
        levels = [call.kwargs["level"] for call in log_mock.await_args_list]
        assert "error" in levels

    @pytest.mark.asyncio
    async def test_get_task_logs_operation(self, test_db: object, test_settings: Settings) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(tasks_module, "log_operation", new=AsyncMock()) as log_mock,
        ):
            await handler(_get_task_request(job_id))

        log_mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_cancel_task_logs_operation(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CancelTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(tasks_module, "log_operation", new=AsyncMock()) as log_mock,
        ):
            await handler(_cancel_task_request(job_id))

        log_mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_completed_task_logs_operation(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db, run_id=run_id, job_input=DiscoveryJobInput()
        )
        await DiscoveryRunCRUD.complete(test_db, run_id, queries_generated=1)
        await DiscoveryJobCRUD.complete(test_db, job_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(tasks_module, "log_operation", new=AsyncMock()) as log_mock,
        ):
            await handler(_get_task_request(job_id))

        log_mock.assert_awaited_once()
