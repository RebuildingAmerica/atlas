"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.platform.mcp.workbench import (
    create_research_brief,
    export_research_brief,
)
from tests.support.mcp_workbench import (
    FakeWorkbenchContext,
    _accepting_context,
)


async def _create_private_brief(
    test_db: object,
    *,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> str:
    brief = await OrgBriefCRUD.create(
        test_db,
        org_id="org_1",
        title="Kansas City housing brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=[sample_entry],
        linked_source_ids=[sample_source],
        linked_discovery_run_ids=[sample_discovery_run],
        confidence_summary={
            "state": "partial",
            "source_count": 1,
            "review_status": "operator_review_required",
        },
        gaps=[{"label": "County coverage", "detail": "Review county-level sources."}],
        created_by="user_1",
    )
    return brief.id


@pytest.mark.asyncio
async def test_brief_requires_confirmation(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> None:
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await create_research_brief(
        ctx,
        title="Kansas City housing brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=[sample_entry],
        linked_source_ids=[sample_source],
        linked_discovery_run_ids=[sample_discovery_run],
        confidence_summary={"state": "partial", "source_count": 1},
        gaps=[],
        db=test_db,
    )

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm brief writes.",
    }
    assert await OrgBriefCRUD.list_by_org(test_db, "org_1") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_brief_rejection_writes_nothing(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
    action: str,
) -> None:
    ctx = FakeWorkbenchContext(action=action)

    result = await create_research_brief(
        ctx,
        title="Kansas City housing brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=[sample_entry],
        linked_source_ids=[sample_source],
        linked_discovery_run_ids=[sample_discovery_run],
        confidence_summary={"state": "partial", "source_count": 1},
        gaps=[],
        db=test_db,
    )

    assert result == {"status": action, "message": "No brief was created."}
    assert await OrgBriefCRUD.list_by_org(test_db, "org_1") == []


@pytest.mark.asyncio
async def test_brief_unchecked_confirmation_writes_nothing(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_create=False,
            visibility="workspace",
            source_linkage_ack=True,
        ),
    )

    result = await create_research_brief(
        ctx,
        title="Kansas City housing brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=[sample_entry],
        linked_source_ids=[sample_source],
        linked_discovery_run_ids=[sample_discovery_run],
        confidence_summary={"state": "partial", "source_count": 1},
        gaps=[],
        db=test_db,
    )

    assert result == {"status": "decline", "message": "No brief was created."}
    assert await OrgBriefCRUD.list_by_org(test_db, "org_1") == []


@pytest.mark.asyncio
async def test_brief_rejects_missing_evidence(test_db: object) -> None:
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            source_linkage_ack=True,
        ),
    )

    result = await create_research_brief(
        ctx,
        title="Kansas City housing brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Brief evidence was not found."}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("linked_entry_ids", "linked_source_ids", "linked_discovery_run_ids"),
    [
        (["missing_entry"], [], []),
        ([], ["missing_source"], []),
        ([], [], ["missing_run"]),
    ],
)
async def test_brief_rejects_missing_linked_evidence(
    test_db: object,
    linked_entry_ids: list[str],
    linked_source_ids: list[str],
    linked_discovery_run_ids: list[str],
) -> None:
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            source_linkage_ack=True,
        ),
    )

    result = await create_research_brief(
        ctx,
        title="Kansas City housing brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=linked_entry_ids,
        linked_source_ids=linked_source_ids,
        linked_discovery_run_ids=linked_discovery_run_ids,
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Brief evidence was not found."}


@pytest.mark.asyncio
async def test_brief_accept_creates_private_brief(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            source_linkage_ack=True,
        ),
    )

    result = await create_research_brief(
        ctx,
        title="Kansas City housing brief",
        scope={
            "geography": "Kansas City, MO",
            "issue_areas": ["housing_affordability"],
        },
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=[sample_entry],
        linked_source_ids=[sample_source],
        linked_discovery_run_ids=[sample_discovery_run],
        confidence_summary={
            "state": "partial",
            "source_count": 1,
            "review_status": "operator_review_required",
        },
        gaps=[{"label": "County coverage", "detail": "Review county-level sources."}],
        db=test_db,
    )

    assert result["status"] == "created"
    assert result["title"] == "Kansas City housing brief"
    assert result["linked_entry_ids"] == [sample_entry]
    assert result["linked_source_ids"] == [sample_source]
    assert result["linked_discovery_run_ids"] == [sample_discovery_run]
    assert result["visibility"] == "workspace"
    brief = await OrgBriefCRUD.get(test_db, str(result["brief_id"]))
    assert brief is not None
    assert brief.created_by == "user_1"
    assert brief.summary == "One source-backed housing lead is ready for review."
    usage_events = await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0)
    assert [
        (event.event_type, event.resource_type, event.resource_id) for event in usage_events
    ] == [("brief_opened", "brief", brief.id)]


@pytest.mark.asyncio
async def test_export_brief_requires_confirmation(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> None:
    brief_id = await _create_private_brief(
        test_db,
        sample_entry=sample_entry,
        sample_source=sample_source,
        sample_discovery_run=sample_discovery_run,
    )
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await export_research_brief(ctx, brief_id=brief_id, db=test_db)

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm brief exports.",
    }
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_export_brief_rejection_writes_nothing(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
    action: str,
) -> None:
    brief_id = await _create_private_brief(
        test_db,
        sample_entry=sample_entry,
        sample_source=sample_source,
        sample_discovery_run=sample_discovery_run,
    )
    ctx = FakeWorkbenchContext(action=action)

    result = await export_research_brief(ctx, brief_id=brief_id, db=test_db)

    assert result == {"status": action, "message": "No brief was exported."}
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


@pytest.mark.asyncio
async def test_export_brief_unchecked_confirmation_writes_nothing(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> None:
    brief_id = await _create_private_brief(
        test_db,
        sample_entry=sample_entry,
        sample_source=sample_source,
        sample_discovery_run=sample_discovery_run,
    )
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_export=False, format="json", source_linkage_ack=True),
    )

    result = await export_research_brief(ctx, brief_id=brief_id, db=test_db)

    assert result == {"status": "decline", "message": "No brief was exported."}
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


@pytest.mark.asyncio
async def test_export_brief_missing_brief_reports_not_found(test_db: object) -> None:
    ctx = _accepting_context(
        SimpleNamespace(confirm_export=True, format="json", source_linkage_ack=True),
    )

    result = await export_research_brief(ctx, brief_id="missing_brief", db=test_db)

    assert result == {"status": "not_found", "message": "Brief not found."}


@pytest.mark.asyncio
async def test_export_brief_accept_returns_source_backed_payload(
    test_db: object,
    sample_entry: str,
    sample_source: str,
    sample_discovery_run: str,
) -> None:
    brief_id = await _create_private_brief(
        test_db,
        sample_entry=sample_entry,
        sample_source=sample_source,
        sample_discovery_run=sample_discovery_run,
    )
    ctx = _accepting_context(
        SimpleNamespace(confirm_export=True, format="json", source_linkage_ack=True),
    )

    result = await export_research_brief(ctx, brief_id=brief_id, db=test_db)

    assert result["status"] == "exported"
    assert result["format"] == "json"
    assert result["brief"]["id"] == brief_id
    assert result["brief"]["linked_entry_ids"] == [sample_entry]
    assert result["brief"]["linked_source_ids"] == [sample_source]
    assert result["brief"]["linked_discovery_run_ids"] == [sample_discovery_run]
    assert result["brief"]["confidence_summary"]["state"] == "partial"
    assert result["brief"]["gaps"] == [
        {"label": "County coverage", "detail": "Review county-level sources."}
    ]
    assert result["provenance"] == {
        "source_count": 1,
        "entry_count": 1,
        "discovery_run_count": 1,
        "confidence_state": "partial",
        "review_status": "operator_review_required",
    }
    usage_events = await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0)
    assert [
        (event.event_type, event.resource_type, event.resource_id) for event in usage_events
    ] == [("brief_exported", "brief", brief_id)]
