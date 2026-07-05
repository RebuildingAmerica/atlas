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

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.domains.discovery.models import DiscoveryRunCRUD as DomainDiscoveryRunCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp import tasks as tasks_module
from atlas.platform.mcp.server import build_mcp
from atlas.platform.mcp.tasks import (
    _START_DISCOVERY_RUN_TOOL,
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


def _handler_for(mcp: Any, request_type: type) -> Any:
    """Return the low-level request handler registered for a request type."""
    return mcp._mcp_server.request_handlers[request_type]  # noqa: SLF001


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
    def test_tool_requires_task_augmented_execution(self) -> None:
        assert _START_DISCOVERY_RUN_TOOL.execution is not None
        assert _START_DISCOVERY_RUN_TOOL.execution.taskSupport == "required"

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
        assert task.taskId == "job_1"
        assert task.status == "working"
        assert task.statusMessage is None
        assert task.ttl == ARBITRARY_TTL_MS
        assert task.pollInterval == ARBITRARY_POLL_INTERVAL_MS

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
        assert task.statusMessage == "fetching sources"

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
        assert task.status == "failed"
        assert task.statusMessage == "boom"
        assert task.lastUpdatedAt > task.createdAt

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
        assert task.taskId == "run_1"
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
        assert task.status == "failed"
        assert task.statusMessage == "pipeline exploded"


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
        assert isinstance(result.root, types.CreateTaskResult)
        assert result.root.task.status == "working"

        job = await DiscoveryJobCRUD.get_by_id(test_db, result.root.task.taskId)
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

        assert isinstance(result.root, types.CreateTaskResult)
        job = await DiscoveryJobCRUD.get_by_run_id(test_db, result.root.task.taskId)
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
        assert first.root.task.taskId == second.root.task.taskId

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

        assert isinstance(result.root, types.CreateTaskResult)

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
        assert task.taskId == job_id

    @pytest.mark.asyncio
    async def test_falls_back_to_run_when_no_job(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        task = await _resolve_task(test_db, run_id)
        assert task.taskId == run_id

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
    async def test_call_tool_rejects_start_discovery_run_without_task_param(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="start_discovery_run", arguments=_start_request()
            ),
        )
        result = await handler(request)
        assert result.root.isError is True

    @pytest.mark.asyncio
    async def test_call_tool_rejects_start_discovery_run_without_authenticated_actor(self) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CallToolRequest)
        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="start_discovery_run",
                arguments=_start_request(),
                task=types.TaskMetadata(),
            ),
        )
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
        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(
                name="start_discovery_run",
                arguments=_start_request(),
                task=types.TaskMetadata(),
            ),
        )
        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            patch.object(
                tasks_module, "_actor_claims_from_request_context", return_value=("org_1", "user_1")
            ),
        ):
            result = await handler(request)
        assert isinstance(result.root, types.CreateTaskResult)

    @pytest.mark.asyncio
    async def test_get_task_wire_handler(self, test_db: object, test_settings: Settings) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(
                types.GetTaskRequest(
                    method="tasks/get", params=types.GetTaskRequestParams(taskId=job_id)
                )
            )

        assert result.root.taskId == job_id
        assert result.root.status == "working"

    @pytest.mark.asyncio
    async def test_get_task_wire_handler_unknown_id_raises(self, test_settings: Settings) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            pytest.raises(McpError),
        ):
            await handler(
                types.GetTaskRequest(
                    method="tasks/get", params=types.GetTaskRequestParams(taskId="nope")
                )
            )

    @pytest.mark.asyncio
    async def test_get_task_result_wire_handler(
        self, test_db: object, test_settings: Settings
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id, job_input=DiscoveryJobInput())
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskPayloadRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(
                types.GetTaskPayloadRequest(
                    method="tasks/result", params=types.GetTaskPayloadRequestParams(taskId=run_id)
                )
            )

        assert isinstance(result.root, types.CallToolResult)
        assert result.root.structuredContent["id"] == run_id

    @pytest.mark.asyncio
    async def test_get_task_result_wire_handler_unknown_id_raises(
        self, test_settings: Settings
    ) -> None:
        mcp = build_mcp()
        handler = _handler_for(mcp, types.GetTaskPayloadRequest)

        with (
            patch.object(tasks_module, "get_settings", return_value=test_settings),
            pytest.raises(McpError),
        ):
            await handler(
                types.GetTaskPayloadRequest(
                    method="tasks/result", params=types.GetTaskPayloadRequestParams(taskId="nope")
                )
            )

    @pytest.mark.asyncio
    async def test_cancel_task_wire_handler(self, test_db: object, test_settings: Settings) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db, location_query="KC", state="MO", issue_areas=["x"]
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        mcp = build_mcp()
        handler = _handler_for(mcp, types.CancelTaskRequest)

        with patch.object(tasks_module, "get_settings", return_value=test_settings):
            result = await handler(
                types.CancelTaskRequest(
                    method="tasks/cancel", params=types.CancelTaskRequestParams(taskId=job_id)
                )
            )

        assert result.root.status == "cancelled"

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
            await handler(
                types.CancelTaskRequest(
                    method="tasks/cancel", params=types.CancelTaskRequestParams(taskId="nope")
                )
            )

    def test_initialization_options_advertise_tasks_capability(self) -> None:
        mcp = build_mcp()
        options = _init_options(mcp)
        assert options.capabilities.tasks is not None
        assert options.capabilities.tasks.requests.tools.call is not None


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
