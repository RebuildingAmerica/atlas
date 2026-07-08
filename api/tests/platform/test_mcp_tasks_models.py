"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

from fastapi import HTTPException
from mcp import types

from atlas.platform.mcp import tasks as tasks_module
from atlas.platform.mcp.tasks import (
    _budget_exceeded_result,
    _job_to_task,
    _run_to_task,
    _tool_error,
)
from tests.support.mcp_tasks import (
    ARBITRARY_POLL_INTERVAL_MS,
    ARBITRARY_TTL_MS,
)


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

    def test_create_task_result_omits_absent_payload_fields(self) -> None:
        task = tasks_module.DraftTask(
            task_id="task_1",
            status="working",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            last_updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            ttl_ms=ARBITRARY_TTL_MS,
            poll_interval_ms=ARBITRARY_POLL_INTERVAL_MS,
        )
        result = tasks_module.DraftCreateTaskResult(task=task)

        payload = result.model_dump(exclude_none=True)

        assert "result" not in payload
        assert "error" not in payload

    def test_server_result_serializes_aliases(self) -> None:
        result = tasks_module.DraftServerResult(tasks_module.DraftEmptyResult())

        assert result.model_dump(exclude_none=True) == {"resultType": "complete"}


class TestTaskCapabilityMetadata:
    def test_declares_tasks_extension_rejects_non_dict_meta(self) -> None:
        assert tasks_module._declares_tasks_extension("not-metadata") is False  # noqa: SLF001

    def test_declares_tasks_extension_rejects_non_dict_capabilities(self) -> None:
        assert (
            tasks_module._declares_tasks_extension(  # noqa: SLF001
                {"io.modelcontextprotocol/clientCapabilities": "not-capabilities"}
            )
            is False
        )
