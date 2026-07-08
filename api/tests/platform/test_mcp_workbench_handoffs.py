"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.platform.mcp import workbench as workbench_module
from tests.support.mcp_workbench import (
    FakeConnection,
    FakeWorkbenchContext,
    _accepting_context,
    _all_confirmation_content,
    _scout_artifacts,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("function_name", "call_kwargs"),
    [
        ("watch_workspace_resource", {"resource_type": "entry", "resource_id": "entry_1"}),
        (
            "create_coverage_target",
            {
                "name": "Kansas City tenant power",
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
            },
        ),
        (
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed housing lead is ready for review.",
                "linked_entry_ids": ["entry_1"],
            },
        ),
        ("export_coverage_report", {}),
        ("sync_scout_artifacts", {"artifacts": _scout_artifacts("local_guard")}),
        ("export_research_brief", {"brief_id": "brief_1"}),
    ],
)
async def test_workspace_handoffs_report_unauthenticated_without_actor(
    function_name: str,
    call_kwargs: dict[str, object],
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=_all_confirmation_content(),
        user_id=None,
    )

    result = await getattr(workbench_module, function_name)(ctx, **call_kwargs)

    assert result == {
        "status": "unauthenticated",
        "message": "Atlas could not identify the MCP user.",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("function_name", "call_kwargs"),
    [
        ("watch_workspace_resource", {"resource_type": "entry", "resource_id": "entry_1"}),
        (
            "create_coverage_target",
            {
                "name": "Kansas City tenant power",
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
            },
        ),
        (
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed housing lead is ready for review.",
                "linked_entry_ids": ["entry_1"],
            },
        ),
        ("export_coverage_report", {}),
        ("sync_scout_artifacts", {"artifacts": _scout_artifacts("local_no_workspace")}),
        ("export_research_brief", {"brief_id": "brief_1"}),
    ],
)
async def test_workspace_handoffs_report_unavailable_without_workspace(
    function_name: str,
    call_kwargs: dict[str, object],
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=_all_confirmation_content(),
        org_id=None,
    )

    result = await getattr(workbench_module, function_name)(ctx, **call_kwargs)

    assert result == {
        "status": "unavailable",
        "message": "No workspace is active for this MCP request.",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("function_name", "call_kwargs", "message", "expected_status"),
    [
        (
            "save_entities_to_list",
            {"list_id": "list_1", "entry_ids": ["entry_1"]},
            "Atlas could not confirm this workspace action.",
            "unavailable",
        ),
        (
            "watch_workspace_resource",
            {"resource_type": "entry", "resource_id": "entry_1"},
            "This MCP client cannot confirm workspace watches.",
            "unsupported",
        ),
        (
            "create_coverage_target",
            {
                "name": "Kansas City tenant power",
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
            },
            "This MCP client cannot confirm coverage-target writes.",
            "unsupported",
        ),
        (
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed housing lead is ready for review.",
                "linked_entry_ids": ["entry_1"],
            },
            "This MCP client cannot confirm brief writes.",
            "unsupported",
        ),
        (
            "export_coverage_report",
            {},
            "This MCP client cannot confirm coverage report exports.",
            "unsupported",
        ),
        (
            "sync_scout_artifacts",
            {"artifacts": _scout_artifacts("local_missing_context")},
            "This MCP client cannot confirm Scout artifact syncs.",
            "unsupported",
        ),
        (
            "export_research_brief",
            {"brief_id": "brief_1"},
            "This MCP client cannot confirm brief exports.",
            "unsupported",
        ),
    ],
)
async def test_workbench_handoffs_report_unavailable_when_context_missing(
    monkeypatch: pytest.MonkeyPatch,
    function_name: str,
    call_kwargs: dict[str, object],
    message: str,
    expected_status: str,
) -> None:
    def fake_declares_form_elicitation(_meta: object) -> bool:
        return True

    monkeypatch.setattr(
        workbench_module, "declares_form_elicitation", fake_declares_form_elicitation
    )

    result = await getattr(workbench_module, function_name)(None, **call_kwargs)

    assert result == {"status": expected_status, "message": message}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("function_name", "call_kwargs", "delegate_name"),
    [
        (
            "save_entities_to_list",
            {
                "list_id": "list_1",
                "entry_ids": ["entry_1"],
            },
            "_save_entities_to_list_with_db",
        ),
        ("export_research_brief", {"brief_id": "brief_1"}, "_export_research_brief_with_db"),
        ("export_coverage_report", {}, "_export_coverage_report_with_db"),
        (
            "sync_scout_artifacts",
            {"artifacts": _scout_artifacts("local_connection")},
            "_sync_scout_artifacts_with_db",
        ),
        (
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed housing lead is ready for review.",
                "linked_entry_ids": ["entry_1"],
            },
            "_create_research_brief_with_db",
        ),
        (
            "create_coverage_target",
            {
                "name": "Kansas City tenant power",
                "geography": "Kansas City, MO",
                "issue_areas": ["housing_affordability"],
                "actor_types": ["organization"],
                "source_types": ["community_archive"],
            },
            "_create_coverage_target_with_db",
        ),
        (
            "watch_workspace_resource",
            {"resource_type": "entry", "resource_id": "entry_1"},
            "_watch_workspace_resource_with_db",
        ),
    ],
)
async def test_workbench_functions_close_owned_database_connections(
    monkeypatch: pytest.MonkeyPatch,
    function_name: str,
    call_kwargs: dict[str, object],
    delegate_name: str,
) -> None:
    connection = FakeConnection()

    async def fake_get_db_connection(database_url: str, *, backend: str) -> FakeConnection:
        assert database_url
        assert backend
        return connection

    async def fake_delegate(db: FakeConnection, request: object) -> dict[str, object]:
        assert db is connection
        assert request is not None
        return {"status": "delegated"}

    monkeypatch.setattr(workbench_module, "get_db_connection", fake_get_db_connection)
    monkeypatch.setattr(workbench_module, delegate_name, fake_delegate)
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_save=True,
            confirm_export=True,
            confirm_sync=True,
            confirm_create=True,
            confirm_watch=True,
            visibility="workspace",
            review_state="in_review",
            notification_preference="immediate",
            format="json",
            source_linkage_ack=True,
        )
    )

    result = await getattr(workbench_module, function_name)(ctx, **call_kwargs)

    assert result == {"status": "delegated"}
    assert connection.closed is True
