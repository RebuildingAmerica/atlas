"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp import tasks as tasks_module
from atlas.platform.mcp.server import build_mcp
from atlas.platform.mcp.tasks import (
    MISSING_REQUIRED_CLIENT_CAPABILITY,
    _tool_error,
)
from tests.support.mcp_tasks import (
    ARBITRARY_POLL_INTERVAL_MS,
    ARBITRARY_TTL_MS,
    TASKS_EXTENSION,
    _call_tool_request,
    _call_tool_request_with_meta,
    _handler_for,
    _start_request,
    _tasks_and_elicitation_meta,
)

if TYPE_CHECKING:
    from atlas.config import Settings


class TestInstallTasksExtensionTools:
    @pytest.mark.asyncio
    async def test_list_tools_includes_start_discovery_run(self) -> None:
        mcp = build_mcp()
        tools = await mcp.list_tools()
        assert any(tool.name == "start_discovery_run" for tool in tools)

    @pytest.mark.asyncio
    async def test_list_tools_request_handler_includes_start_discovery_run(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.ListToolsRequest)
        result = await handler(types.ListToolsRequest(method="tools/list"))
        assert any(tool.name == "start_discovery_run" for tool in result.root.tools)

    @pytest.mark.asyncio
    async def test_list_tools_request_handler_returns_all_tools_on_one_page_by_default(
        self,
    ) -> None:
        mcp = build_mcp()
        registered_tools = await mcp.list_tools()
        handler = _handler_for(mcp, types.ListToolsRequest)
        result = await handler(types.ListToolsRequest(method="tools/list"))
        assert len(result.root.tools) == len(registered_tools)
        assert result.root.nextCursor is None

    @pytest.mark.asyncio
    async def test_list_tools_request_handler_paginates_with_smaller_page_size(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.ListToolsRequest)
        page_size = 2

        with patch.object(tasks_module, "_TOOLS_PAGE_SIZE", page_size):
            first_page = await handler(types.ListToolsRequest(method="tools/list"))
            assert len(first_page.root.tools) == page_size
            assert first_page.root.nextCursor == str(page_size)

            second_page = await handler(
                types.ListToolsRequest(
                    method="tools/list",
                    params=types.PaginatedRequestParams(cursor=first_page.root.nextCursor),
                )
            )
            assert len(second_page.root.tools) == page_size
            assert {t.name for t in first_page.root.tools}.isdisjoint(
                {t.name for t in second_page.root.tools}
            )

    @pytest.mark.asyncio
    async def test_list_tools_request_handler_last_page_has_no_next_cursor(self) -> None:
        mcp = build_mcp()
        registered_tools = await mcp.list_tools()
        handler = _handler_for(mcp, types.ListToolsRequest)

        with patch.object(tasks_module, "_TOOLS_PAGE_SIZE", 2):
            result = await handler(
                types.ListToolsRequest(
                    method="tools/list",
                    params=types.PaginatedRequestParams(cursor=str(len(registered_tools) - 1)),
                )
            )
            assert len(result.root.tools) == 1
            assert result.root.nextCursor is None

    @pytest.mark.asyncio
    async def test_list_tools_request_handler_invalid_cursor_raises(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.ListToolsRequest)

        with pytest.raises(McpError):
            await handler(
                types.ListToolsRequest(
                    method="tools/list",
                    params=types.PaginatedRequestParams(cursor="not-a-number"),
                )
            )

    @pytest.mark.asyncio
    async def test_list_tools_request_handler_tolerates_none_request(self) -> None:
        """_get_cached_tool_definition calls this handler with req=None to refresh
        its cache; it must return everything, not paginate or raise."""
        mcp = build_mcp()
        registered_tools = await mcp.list_tools()
        handler = _handler_for(mcp, types.ListToolsRequest)

        with patch.object(tasks_module, "_TOOLS_PAGE_SIZE", 2):
            result = await handler(None)

        assert len(result.root.tools) == len(registered_tools)
        assert result.root.nextCursor is None

    @pytest.mark.asyncio
    async def test_call_tool_delegates_other_tools_unchanged(self, test_settings: Settings) -> None:
        with patch("atlas.platform.mcp.server.get_settings", return_value=test_settings):
            mcp = build_mcp()
            handler = _handler_for(mcp, types.CallToolRequest)
            request = types.CallToolRequest(
                method="tools/call",
                params=types.CallToolRequestParams(name="search_entities", arguments={"limit": 1}),
            )
            result = await handler(request)
        assert isinstance(result.root, types.CallToolResult)
        assert result.root.isError is False

    @pytest.mark.asyncio
    async def test_call_tool_rejects_start_discovery_run_without_tasks_capability(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="start_discovery_run", arguments=_start_request()
            ),
        )
        with pytest.raises(McpError) as exc_info:
            await handler(request)
        assert exc_info.value.error.code == MISSING_REQUIRED_CLIENT_CAPABILITY
        assert (
            exc_info.value.error.data["requiredCapabilities"]["extensions"][TASKS_EXTENSION] == {}
        )

    @pytest.mark.asyncio
    async def test_call_tool_rejects_start_discovery_run_without_authenticated_actor(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = _call_tool_request("start_discovery_run", _start_request())
        with patch.object(
            tasks_module, "_actor_claims_from_request_context", return_value=(None, None)
        ):
            result = await handler(request)
        assert result.root.isError is True

    @pytest.mark.asyncio
    async def test_call_tool_creates_task_for_authenticated_actor(
        self, test_settings: Settings
    ) -> None:
        test_settings.discovery_inline = False
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = _call_tool_request("start_discovery_run", _start_request())
        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(
                tasks_module, "_actor_claims_from_request_context", return_value=("org_1", "user_1")
            ),
        ):
            result = await handler(request)
        assert result.root.result_type == "task"
        assert result.root.task.status == "working"
        assert result.root.task.ttl_ms == ARBITRARY_TTL_MS

    @pytest.mark.asyncio
    async def test_call_tool_preflight_decline_stops(self, test_settings: Settings) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = _call_tool_request_with_meta(
            "start_discovery_run",
            _start_request(),
            _tasks_and_elicitation_meta(),
        )
        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(
                tasks_module, "_actor_claims_from_request_context", return_value=("org_1", "user_1")
            ),
            patch.object(
                tasks_module,
                "_preflight_discovery_run_arguments",
                new=AsyncMock(return_value=_tool_error("Discovery run not started.")),
            ) as preflight_mock,
            patch.object(
                tasks_module, "_create_discovery_run_task", new=AsyncMock()
            ) as create_mock,
        ):
            result = await handler(request)

        assert result.root.isError is True
        assert result.root.content[0].text == "Discovery run not started."
        preflight_mock.assert_awaited_once()
        create_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_call_tool_uses_preflight_args(self, test_settings: Settings) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = _call_tool_request_with_meta(
            "start_discovery_run",
            _start_request(location_query="Portland", state="OR"),
            _tasks_and_elicitation_meta(),
        )
        confirmed = _start_request(location_query="Portland, ME", state="ME")
        task = tasks_module.DraftTask(
            task_id="job_1",
            status="working",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            last_updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            ttl_ms=ARBITRARY_TTL_MS,
            poll_interval_ms=ARBITRARY_POLL_INTERVAL_MS,
        )
        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(
                tasks_module, "_actor_claims_from_request_context", return_value=("org_1", "user_1")
            ),
            patch.object(
                tasks_module,
                "_preflight_discovery_run_arguments",
                new=AsyncMock(return_value=confirmed),
            ),
            patch.object(
                tasks_module,
                "_create_discovery_run_task",
                new=AsyncMock(
                    return_value=tasks_module.DraftServerResult(
                        tasks_module.DraftCreateTaskResult(task=task)
                    )
                ),
            ) as create_mock,
        ):
            result = await handler(request)

        assert result.root.task.task_id == "job_1"
        create_mock.assert_awaited_once()
        assert create_mock.await_args.kwargs["arguments"] == confirmed
