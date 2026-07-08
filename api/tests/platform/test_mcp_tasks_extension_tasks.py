"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp import tasks as tasks_module
from atlas.platform.mcp.server import build_mcp
from tests.support.mcp_tasks import (
    ARBITRARY_TTL_MS,
    _cancel_task_request,
    _get_task_request,
    _handler_for,
    _init_options,
)

if TYPE_CHECKING:
    from atlas.config import Settings


class TestInstallTasksExtensionTasks:
    @pytest.mark.asyncio
    async def test_get_task_wire_handler(self, test_db: object, test_settings: Settings) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_get_task_request(job_id))

        assert result.root.task_id == job_id
        assert result.root.result_type == "complete"
        assert result.root.status == "working"
        assert result.root.ttl_ms == ARBITRARY_TTL_MS

    @pytest.mark.asyncio
    async def test_get_task_wire_handler_unknown_id_raises(self, test_settings: Settings) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            pytest.raises(McpError),
        ):
            await handler(_get_task_request("nope"))

    @pytest.mark.asyncio
    async def test_get_task_completed_inlines_discovery_run_result(
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

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_get_task_request(job_id))

        assert result.root.result_type == "complete"
        assert result.root.status == "completed"
        assert result.root.result["structuredContent"]["id"] == run_id
        assert result.root.result["isError"] is False

    @pytest.mark.asyncio
    async def test_get_task_completed_job_without_run_raises(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db, run_id=run_id, job_input=DiscoveryJobInput()
        )
        await DiscoveryJobCRUD.complete(test_db, job_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(
                tasks_module.DiscoveryRunCRUD, "get_by_id", new=AsyncMock(return_value=None)
            ),
            pytest.raises(McpError) as exc_info,
        ):
            await handler(_get_task_request(job_id))

        assert exc_info.value.error.code == types.INVALID_PARAMS
        assert "Unknown task" in exc_info.value.error.message

    @pytest.mark.asyncio
    async def test_get_task_failed_job_returns_completed_tool_error(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await DiscoveryJobCRUD.fail(test_db, job_id, "pipeline exploded", retryable=False)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_get_task_request(job_id))

        assert result.root.result_type == "complete"
        assert result.root.status == "completed"
        assert result.root.result["isError"] is True
        assert "pipeline exploded" in result.root.result["content"][0]["text"]

    @pytest.mark.asyncio
    async def test_get_task_completed_inline_run_inlines_result(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        await DiscoveryRunCRUD.complete(test_db, run_id, queries_generated=1)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_get_task_request(run_id))

        assert result.root.status == "completed"
        assert result.root.result["structuredContent"]["id"] == run_id
        assert result.root.result["isError"] is False

    @pytest.mark.asyncio
    async def test_get_task_working_inline_run_has_no_result(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_get_task_request(run_id))

        assert result.root.status == "working"
        assert result.root.result is None

    @pytest.mark.asyncio
    async def test_get_task_failed_inline_run_returns_completed_tool_error(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        await DiscoveryRunCRUD.fail(test_db, run_id, error_message="inline exploded")
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_get_task_request(run_id))

        assert result.root.status == "completed"
        assert result.root.result["isError"] is True
        assert "inline exploded" in result.root.result["content"][0]["text"]

    @pytest.mark.asyncio
    async def test_cancel_task_wire_handler(self, test_db: object, test_settings: Settings) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CancelTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(_cancel_task_request(job_id))

        assert result.root.result_type == "complete"
        assert result.root.model_dump(by_alias=True, exclude_none=True) == {
            "resultType": "complete"
        }

    @pytest.mark.asyncio
    async def test_cancel_task_wire_handler_unknown_id_raises(
        self, test_settings: Settings
    ) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CancelTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            pytest.raises(McpError),
        ):
            await handler(_cancel_task_request("nope"))

    def test_initialization_options_do_not_advertise_legacy_tasks_capability(self) -> None:
        mcp = build_mcp()
        options = _init_options(mcp)
        assert options.capabilities.tasks is None
