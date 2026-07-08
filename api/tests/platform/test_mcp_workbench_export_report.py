"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.platform.mcp.workbench import (
    export_coverage_report,
)
from tests.support.mcp_workbench import (
    FakeWorkbenchContext,
)


async def _create_coverage_target(
    test_db: object,
    *,
    sample_entry: str,
) -> str:
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id="org_1",
        name="Kansas City tenant power",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        gaps=[{"label": "County coverage", "detail": "Review county source coverage."}],
        next_actions=["Review county source coverage"],
        linked_discovery_run_ids=[],
        linked_entry_ids=[sample_entry],
        created_by="user_1",
        review_state="in_review",
    )
    return target.id


@pytest.mark.asyncio
async def test_export_report_requires_confirmation(
    test_db: object,
    sample_entry: str,
) -> None:
    await _create_coverage_target(test_db, sample_entry=sample_entry)
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await export_coverage_report(ctx, db=test_db)

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm coverage report exports.",
    }
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_export_report_rejection_writes_nothing(
    test_db: object,
    sample_entry: str,
    action: str,
) -> None:
    await _create_coverage_target(test_db, sample_entry=sample_entry)
    ctx = FakeWorkbenchContext(action=action)

    result = await export_coverage_report(ctx, db=test_db)

    assert result == {"status": action, "message": "No coverage report was exported."}
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


@pytest.mark.asyncio
async def test_export_report_unchecked_confirmation_writes_nothing(
    test_db: object,
    sample_entry: str,
) -> None:
    await _create_coverage_target(test_db, sample_entry=sample_entry)
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_export=False, format="json", source_linkage_ack=True),
    )

    result = await export_coverage_report(ctx, db=test_db)

    assert result == {"status": "decline", "message": "No coverage report was exported."}
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


@pytest.mark.asyncio
async def test_export_report_accept_returns_report(
    test_db: object,
    sample_entry: str,
) -> None:
    target_id = await _create_coverage_target(test_db, sample_entry=sample_entry)
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_export=True, format="json", source_linkage_ack=True),
    )

    result = await export_coverage_report(ctx, db=test_db)

    assert result["status"] == "exported"
    assert result["format"] == "json"
    assert result["report"]["summary"]["total_targets"] == 1
    assert result["report"]["targets"][0]["id"] == target_id
    assert result["report"]["targets"][0]["linked_entry_ids"] == [sample_entry]
    usage_events = await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0)
    assert [
        (event.event_type, event.resource_type, event.resource_id) for event in usage_events
    ] == [("coverage_report_exported", "coverage_report", "org_1")]
