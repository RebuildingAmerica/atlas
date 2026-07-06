"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from mcp import types
from mcp.shared.exceptions import McpError
from starlette.responses import Response

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.domains.discovery.models import DiscoveryRunCRUD as DomainDiscoveryRunCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp import tasks as tasks_module
from atlas.platform.mcp.server import build_mcp
from atlas.platform.mcp.tasks import (
    _START_DISCOVERY_RUN_TOOL,
    MISSING_REQUIRED_CLIENT_CAPABILITY,
    _actor_claims_from_request_context,
    _budget_exceeded_result,
    _create_discovery_run_task,
    _derive_idempotency_key,
    _job_to_task,
    _resolve_task,
    _run_to_task,
    _tool_error,
)
from atlas.schemas import DiscoveryRunStartRequest

if TYPE_CHECKING:
    from atlas.config import Settings

ARBITRARY_TTL_MS = 30 * 60 * 1000
ARBITRARY_POLL_INTERVAL_MS = 5_000
EXPECTED_TOTAL_TOOL_COUNT = 13
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


class TestStartDiscoveryRunToolDefinition:
    def test_tool_uses_draft_capability_negotiation_instead_of_legacy_task_metadata(
        self,
    ) -> None:
        assert _START_DISCOVERY_RUN_TOOL.execution is None

    def test_tool_schema_matches_discovery_run_start_request(self) -> None:
        properties = _START_DISCOVERY_RUN_TOOL.inputSchema.get("properties", {})
        assert {"location_query", "state", "issue_areas", "research_goal"} <= set(properties)


class TestDeriveIdempotencyKey:
    def test_same_inputs_produce_same_key(self) -> None:
        req = DiscoveryRunStartRequest.model_validate(_start_request())
        first = _derive_idempotency_key("org_1", req)
        second = _derive_idempotency_key("org_1", req)
        assert first == second

    def test_different_org_produces_different_key(self) -> None:
        req = DiscoveryRunStartRequest.model_validate(_start_request())
        assert _derive_idempotency_key("org_1", req) != _derive_idempotency_key("org_2", req)

    def test_different_issue_area_order_produces_same_key(self) -> None:
        req_a = DiscoveryRunStartRequest.model_validate(
            _start_request(issue_areas=["housing_affordability", "worker_cooperatives"])
        )
        req_b = DiscoveryRunStartRequest.model_validate(
            _start_request(issue_areas=["worker_cooperatives", "housing_affordability"])
        )
        assert _derive_idempotency_key("org_1", req_a) == _derive_idempotency_key("org_1", req_b)

    def test_key_is_prefixed_and_scoped_to_today(self) -> None:
        req = DiscoveryRunStartRequest.model_validate(_start_request())
        key = _derive_idempotency_key("org_1", req)
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        assert key.startswith("mcp:org_1:")
        assert key.endswith(f":{today}")


class TestJobAndRunToTask:
    def test_queued_job_maps_to_working(self) -> None:
        job = MagicMock(
            id="job_1",
            status="queued",
            progress=None,
            error_message=None,
            created_at="2026-01-01T00:00:00+00:00",
            completed_at=None,
        )
        task = _job_to_task(job)
        assert task.task_id == "job_1"
        assert task.status == "working"
        assert task.status_message is None
        assert task.ttl_ms == ARBITRARY_TTL_MS
        assert task.poll_interval_ms == ARBITRARY_POLL_INTERVAL_MS

    def test_running_job_surfaces_progress_message(self) -> None:
        job = MagicMock(
            id="job_1",
            status="running",
            progress={"message": "fetching sources"},
            error_message=None,
            created_at="2026-01-01T00:00:00+00:00",
            completed_at=None,
        )
        task = _job_to_task(job)
        assert task.status == "working"
        assert task.status_message == "fetching sources"

    def test_failed_job_surfaces_error_message(self) -> None:
        job = MagicMock(
            id="job_1",
            status="failed",
            progress={"message": "ignored for failed jobs"},
            error_message="boom",
            created_at="2026-01-01T00:00:00+00:00",
            completed_at="2026-01-01T00:05:00+00:00",
        )
        task = _job_to_task(job)
        assert task.status == "completed"
        assert task.status_message == "boom"
        assert task.last_updated_at > task.created_at

    def test_completed_job_maps_to_completed(self) -> None:
        job = MagicMock(
            id="job_1",
            status="completed",
            progress=None,
            error_message=None,
            created_at="2026-01-01T00:00:00+00:00",
            completed_at="2026-01-01T00:05:00+00:00",
        )
        assert _job_to_task(job).status == "completed"

    def test_cancelled_job_maps_to_cancelled(self) -> None:
        job = MagicMock(
            id="job_1",
            status="cancelled",
            progress=None,
            error_message=None,
            created_at="2026-01-01T00:00:00+00:00",
            completed_at="2026-01-01T00:05:00+00:00",
        )
        assert _job_to_task(job).status == "cancelled"

    def test_run_without_job_maps_status_directly(self) -> None:
        run = MagicMock(
            id="run_1",
            status="completed",
            error_message=None,
            started_at="2026-01-01T00:00:00+00:00",
            completed_at="2026-01-01T00:05:00+00:00",
        )
        task = _run_to_task(run)
        assert task.task_id == "run_1"
        assert task.status == "completed"

    def test_failed_run_surfaces_error_message(self) -> None:
        run = MagicMock(
            id="run_1",
            status="failed",
            error_message="pipeline exploded",
            started_at="2026-01-01T00:00:00+00:00",
            completed_at="2026-01-01T00:05:00+00:00",
        )
        task = _run_to_task(run)
        assert task.status == "completed"
        assert task.status_message == "pipeline exploded"


class TestToolErrorBuilders:
    def test_tool_error_marks_is_error(self) -> None:
        result = _tool_error("nope")
        assert result.root.isError is True
        assert result.root.content[0].text == "nope"

    def test_budget_exceeded_result_carries_structured_detail(self) -> None:
        exc = HTTPException(
            status_code=409,
            detail={
                "org_id": "org_1",
                "month": "2026-07",
                "monthly_run_limit": 5,
                "used_runs": 5,
                "remaining_runs": 0,
            },
        )
        result = _budget_exceeded_result(exc)
        assert result.root.isError is True
        assert result.root.structuredContent == exc.detail
        assert "org_1" in result.root.content[0].text


class TestDraftResultSerialization:
    def test_create_task_result_serializes_flat_wire_shape(self) -> None:
        task = tasks_module.DraftTask(
            task_id="task_1",
            status="working",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            last_updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            ttl_ms=ARBITRARY_TTL_MS,
            poll_interval_ms=ARBITRARY_POLL_INTERVAL_MS,
        )
        result = tasks_module.DraftCreateTaskResult(
            task=task,
            result={"ok": True},
            error={"code": types.INTERNAL_ERROR, "message": "boom"},
        )

        payload = result.model_dump(exclude_none=True)

        assert payload["resultType"] == "task"
        assert payload["taskId"] == "task_1"
        assert "task" not in payload
        assert payload["ttlMs"] == ARBITRARY_TTL_MS
        assert payload["pollIntervalMs"] == ARBITRARY_POLL_INTERVAL_MS
        assert payload["result"] == {"ok": True}
        assert payload["error"]["code"] == types.INTERNAL_ERROR

    def test_server_result_serializes_aliases(self) -> None:
        result = tasks_module.DraftServerResult(tasks_module.DraftEmptyResult())

        assert result.model_dump(exclude_none=True) == {"resultType": "complete"}


class TestCreateDiscoveryRunTask:
    @pytest.mark.asyncio
    async def test_creates_job_and_returns_working_task(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.discovery_inline = False
        result = await _create_discovery_run_task(
            test_db,
            org_id="org_1",
            user_id="user_1",
            settings=test_settings,
            arguments=_start_request(),
        )
        assert result.root.result_type == "task"
        assert result.root.task.status == "working"
        assert result.root.task.ttl_ms == ARBITRARY_TTL_MS

        job = await DiscoveryJobCRUD.get_by_id(test_db, result.root.task.task_id)
        assert job is not None
        assert job.status == "queued"

    @pytest.mark.asyncio
    async def test_inline_settings_returns_completed_task_from_run(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.discovery_inline = True
        with patch(
            "atlas.domains.discovery.run_creation.run_discovery_pipeline_for_run",
            new=AsyncMock(return_value=None),
        ):
            result = await _create_discovery_run_task(
                test_db,
                org_id="org_1",
                user_id="user_1",
                settings=test_settings,
                arguments=_start_request(),
            )

        assert result.root.result_type == "task"
        job = await DiscoveryJobCRUD.get_by_run_id(test_db, result.root.task.task_id)
        assert job is None

    @pytest.mark.asyncio
    async def test_invalid_arguments_returns_tool_error(
        self, test_db: object, test_settings: Settings
    ) -> None:
        result = await _create_discovery_run_task(
            test_db,
            org_id="org_1",
            user_id="user_1",
            settings=test_settings,
            arguments={"location_query": "Kansas City, MO"},  # missing required fields
        )
        assert result.root.isError is True

    @pytest.mark.asyncio
    async def test_repeat_call_within_window_reuses_existing_job(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.discovery_inline = False
        first = await _create_discovery_run_task(
            test_db,
            org_id="org_1",
            user_id="user_1",
            settings=test_settings,
            arguments=_start_request(),
        )
        second = await _create_discovery_run_task(
            test_db,
            org_id="org_1",
            user_id="user_1",
            settings=test_settings,
            arguments=_start_request(),
        )
        assert first.root.task.task_id == second.root.task.task_id

    @pytest.mark.asyncio
    async def test_budget_exhaustion_returns_error_without_creating_job(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.discovery_inline = False
        await OrgDiscoveryBudgetCRUD.set_budget(
            test_db, org_id="org_1", month=datetime.now(UTC).strftime("%Y-%m"), monthly_run_limit=0
        )

        result = await _create_discovery_run_task(
            test_db,
            org_id="org_1",
            user_id="user_1",
            settings=test_settings,
            arguments=_start_request(),
        )

        assert result.root.isError is True
        assert result.root.structuredContent["org_id"] == "org_1"
        runs = await DomainDiscoveryRunCRUD.list(
            test_db, state=None, status=None, limit=50, offset=0
        )
        assert runs == []

    @pytest.mark.asyncio
    async def test_membership_check_rejects_non_member(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.auth_membership_verification_url = "https://auth.example.com"

        with patch(
            "atlas.platform.mcp.tasks.verify_org_membership", new=AsyncMock(return_value=None)
        ):
            result = await _create_discovery_run_task(
                test_db,
                org_id="org_1",
                user_id="user_1",
                settings=test_settings,
                arguments=_start_request(),
            )

        assert result.root.isError is True

    @pytest.mark.asyncio
    async def test_membership_check_allows_verified_member(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.auth_membership_verification_url = "https://auth.example.com"
        test_settings.discovery_inline = False
        membership = MagicMock()

        with patch(
            "atlas.platform.mcp.tasks.verify_org_membership", new=AsyncMock(return_value=membership)
        ):
            result = await _create_discovery_run_task(
                test_db,
                org_id="org_1",
                user_id="user_1",
                settings=test_settings,
                arguments=_start_request(),
            )

        assert result.root.result_type == "task"

    @pytest.mark.asyncio
    async def test_records_org_usage_event_with_target_metadata(
        self, test_db: object, test_settings: Settings
    ) -> None:
        test_settings.discovery_inline = False
        with patch.object(OrgUsageEventCRUD, "record", new=AsyncMock()) as record_mock:
            await _create_discovery_run_task(
                test_db,
                org_id="org_1",
                user_id="user_1",
                settings=test_settings,
                arguments=_start_request(),
            )

        record_mock.assert_awaited_once()
        _conn, record = record_mock.call_args.args
        metadata = json.loads(record.metadata_json)
        assert metadata["location_query"] == "Kansas City, MO"
        assert metadata["surface"] == "mcp"


class TestResolveTask:
    @pytest.mark.asyncio
    async def test_resolves_job_by_id(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        task = await _resolve_task(test_db, job_id)
        assert task.task_id == job_id

    @pytest.mark.asyncio
    async def test_falls_back_to_run_when_no_job(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        task = await _resolve_task(test_db, run_id)
        assert task.task_id == run_id

    @pytest.mark.asyncio
    async def test_unknown_task_id_raises_mcp_error(self, test_db: object) -> None:
        with pytest.raises(McpError):
            await _resolve_task(test_db, "no-such-id")


class TestInstallTasksExtension:
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
        handler = _handler_for(mcp, types.ListToolsRequest)
        result = await handler(types.ListToolsRequest(method="tools/list"))
        assert len(result.root.tools) == EXPECTED_TOTAL_TOOL_COUNT
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
        handler = _handler_for(mcp, types.ListToolsRequest)

        with patch.object(tasks_module, "_TOOLS_PAGE_SIZE", 2):
            result = await handler(
                types.ListToolsRequest(
                    method="tools/list",
                    params=types.PaginatedRequestParams(cursor=str(EXPECTED_TOTAL_TOOL_COUNT - 1)),
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
        handler = _handler_for(mcp, types.ListToolsRequest)

        with patch.object(tasks_module, "_TOOLS_PAGE_SIZE", 2):
            result = await handler(None)

        assert len(result.root.tools) == EXPECTED_TOTAL_TOOL_COUNT
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

    @pytest.mark.asyncio
    async def test_draft_server_discover_advertises_tasks_extension(self) -> None:
        response = await _handle_draft_tasks_jsonrpc(
            {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {}}
        )
        assert response == {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"capabilities": {"extensions": {TASKS_EXTENSION: {}}}},
        }

    @pytest.mark.asyncio
    async def test_draft_tasks_update_acknowledges_known_task(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            response = await _handle_draft_tasks_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": 7,
                    "method": "tasks/update",
                    "params": {
                        "taskId": job_id,
                        "inputResponses": {"unknown": {"action": "accept"}},
                        "_meta": _tasks_meta(),
                    },
                }
            )

        assert response == {"jsonrpc": "2.0", "id": 7, "result": {"resultType": "complete"}}

    @pytest.mark.asyncio
    async def test_draft_tasks_update_requires_tasks_capability(self) -> None:
        response = await _handle_draft_tasks_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tasks/update",
                "params": {"taskId": "job_1", "inputResponses": {}},
            }
        )

        assert response["error"]["code"] == MISSING_REQUIRED_CLIENT_CAPABILITY
        assert (
            response["error"]["data"]["requiredCapabilities"]["extensions"][TASKS_EXTENSION] == {}
        )

    @pytest.mark.asyncio
    async def test_draft_jsonrpc_ignores_unhandled_payloads(self) -> None:
        assert await _handle_draft_tasks_jsonrpc("not-json") is None
        assert await _handle_draft_tasks_jsonrpc({"jsonrpc": "2.0", "method": 7}) is None
        assert (
            await _handle_draft_tasks_jsonrpc(
                {"jsonrpc": "2.0", "id": 9, "method": "tools/list", "params": {}}
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_draft_tasks_update_rejects_invalid_params(self) -> None:
        response = await _handle_draft_tasks_jsonrpc(
            {"jsonrpc": "2.0", "id": 9, "method": "tasks/update", "params": []}
        )

        assert response["error"]["code"] == types.INVALID_PARAMS

    @pytest.mark.asyncio
    async def test_draft_tasks_update_rejects_invalid_task_id(self) -> None:
        response = await _handle_draft_tasks_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tasks/update",
                "params": {
                    "taskId": "",
                    "inputResponses": {},
                    "_meta": _tasks_meta(),
                },
            }
        )

        assert response["error"]["code"] == types.INVALID_PARAMS
        assert response["error"]["message"] == "Invalid or missing taskId"

    @pytest.mark.asyncio
    async def test_draft_tasks_update_rejects_invalid_input_responses(self) -> None:
        response = await _handle_draft_tasks_jsonrpc(
            {
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tasks/update",
                "params": {
                    "taskId": "job_1",
                    "inputResponses": [],
                    "_meta": _tasks_meta(),
                },
            }
        )

        assert response["error"]["code"] == types.INVALID_PARAMS
        assert response["error"]["message"] == "Invalid inputResponses"

    @pytest.mark.asyncio
    async def test_draft_tasks_update_rejects_unknown_task(self, test_settings: Settings) -> None:
        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            response = await _handle_draft_tasks_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": 9,
                    "method": "tasks/update",
                    "params": {
                        "taskId": "nope",
                        "inputResponses": {},
                        "_meta": _tasks_meta(),
                    },
                }
            )

        assert response["error"]["code"] == types.INVALID_PARAMS
        assert response["error"]["message"] == "Unknown task: nope"


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


class TestActorClaimsFromRequestContext:
    def test_returns_none_when_no_request(self) -> None:
        server = MagicMock()
        server.request_context.request = None
        assert _actor_claims_from_request_context(server) == (None, None)

    def test_returns_none_outside_request_context(self) -> None:
        server = MagicMock()
        type(server).request_context = property(lambda _self: (_ for _ in ()).throw(LookupError))
        assert _actor_claims_from_request_context(server) == (None, None)

    def test_extracts_org_id_and_user_id_from_payload(self) -> None:
        server = MagicMock()
        request = MagicMock()
        request.state.mcp_auth_payload = {"org_id": "org_1", "sub": "user_1"}
        server.request_context.request = request
        assert _actor_claims_from_request_context(server) == ("org_1", "user_1")
