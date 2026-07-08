"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp import types

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.budget import OrgDiscoveryBudgetCRUD
from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD as DomainDiscoveryRunCRUD
from atlas.platform.mcp.tasks import (
    DiscoveryRunPreflight,
    _apply_discovery_run_preflight,
    _create_discovery_run_task,
    _preflight_discovery_run_arguments,
)
from tests.support.mcp_tasks import (
    ARBITRARY_TTL_MS,
    FakePreflightServer,
    FakePreflightServerWithoutContext,
    _start_request,
    _tasks_and_elicitation_meta,
    _tasks_meta,
)

if TYPE_CHECKING:
    from atlas.config import Settings


class TestDiscoveryRunPreflight:
    def test_preflight_trims_overrides(self) -> None:
        arguments = _apply_discovery_run_preflight(
            _start_request(),
            DiscoveryRunPreflight(
                confirm_run=True,
                location_query=" Springfield, MA ",
                state="ma",
                issue_areas=[" housing_affordability ", "public_transit"],
                research_goal="landscape_scan",
                search_depth="deep",
            ),
        )

        assert arguments["location_query"] == "Springfield, MA"
        assert arguments["state"] == "MA"
        assert arguments["issue_areas"] == ["housing_affordability", "public_transit"]
        assert arguments["search_depth"] == "deep"

    def test_preflight_keeps_existing_args_when_optional_values_empty(self) -> None:
        arguments = _apply_discovery_run_preflight(
            _start_request(search_depth="quick"),
            DiscoveryRunPreflight(
                confirm_run=True,
                location_query=" ",
                state=None,
                issue_areas=None,
                research_goal=" ",
                search_depth=None,
            ),
        )

        assert arguments == _start_request(search_depth="quick")

    @pytest.mark.asyncio
    async def test_preflight_needs_client_support(self) -> None:
        server = FakePreflightServer(types.ElicitResult(action="decline"))

        result = await _preflight_discovery_run_arguments(
            server,
            params=types.CallToolRequestParams(name="start_discovery_run", _meta=_tasks_meta()),
            arguments=_start_request(),
        )

        assert result == _start_request()
        assert server.session.calls == []

    @pytest.mark.asyncio
    async def test_preflight_without_request_context_keeps_args(self) -> None:
        result = await _preflight_discovery_run_arguments(
            FakePreflightServerWithoutContext(),
            params=types.CallToolRequestParams(
                name="start_discovery_run", _meta=_tasks_and_elicitation_meta()
            ),
            arguments=_start_request(),
        )

        assert result == _start_request()

    @pytest.mark.asyncio
    async def test_preflight_accept_applies_args(self) -> None:
        server = FakePreflightServer(
            types.ElicitResult(
                action="accept",
                content={
                    "confirm_run": True,
                    "location_query": "Portland, ME",
                    "state": "ME",
                    "issue_areas": ["housing_affordability"],
                    "research_goal": "landscape_scan",
                    "search_depth": "standard",
                },
            )
        )

        result = await _preflight_discovery_run_arguments(
            server,
            params=types.CallToolRequestParams(
                name="start_discovery_run", _meta=_tasks_and_elicitation_meta()
            ),
            arguments=_start_request(location_query="Portland", state="OR"),
        )

        assert isinstance(result, dict)
        assert result["location_query"] == "Portland, ME"
        assert result["state"] == "ME"
        assert server.session.calls[0]["message"] == (
            "Confirm this discovery run before using a monthly research run."
        )
        properties = server.session.calls[0]["requestedSchema"]["properties"]
        assert {"confirm_run", "location_query", "state", "issue_areas"} <= set(properties)

    @pytest.mark.parametrize("action", ["decline", "cancel"])
    @pytest.mark.asyncio
    async def test_preflight_decline_stops(self, action: str) -> None:
        server = FakePreflightServer(types.ElicitResult(action=action))

        result = await _preflight_discovery_run_arguments(
            server,
            params=types.CallToolRequestParams(
                name="start_discovery_run", _meta=_tasks_and_elicitation_meta()
            ),
            arguments=_start_request(),
        )

        assert isinstance(result, types.ServerResult)
        assert result.root.isError is True
        assert result.root.content[0].text == "Discovery run not started."

    @pytest.mark.asyncio
    async def test_preflight_unconfirmed_stops(self) -> None:
        server = FakePreflightServer(
            types.ElicitResult(action="accept", content={"confirm_run": False})
        )

        result = await _preflight_discovery_run_arguments(
            server,
            params=types.CallToolRequestParams(
                name="start_discovery_run", _meta=_tasks_and_elicitation_meta()
            ),
            arguments=_start_request(),
        )

        assert isinstance(result, types.ServerResult)
        assert result.root.isError is True
        assert result.root.content[0].text == "Discovery run not started."

    @pytest.mark.asyncio
    async def test_preflight_invalid_response_errors(self) -> None:
        server = FakePreflightServer(types.ElicitResult(action="accept", content={}))

        result = await _preflight_discovery_run_arguments(
            server,
            params=types.CallToolRequestParams(
                name="start_discovery_run", _meta=_tasks_and_elicitation_meta()
            ),
            arguments=_start_request(),
        )

        assert isinstance(result, types.ServerResult)
        assert result.root.isError is True
        assert "Invalid discovery run preflight response" in result.root.content[0].text


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
    async def test_budget_exhaustion_skips_job(
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
    async def test_records_usage_event(self, test_db: object, test_settings: Settings) -> None:
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
