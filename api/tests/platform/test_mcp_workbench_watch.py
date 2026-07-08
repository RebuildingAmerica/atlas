"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.access.models.watches import OrgWatchCRUD
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.platform.mcp.workbench import (
    watch_workspace_resource,
)
from tests.support.mcp_workbench import (
    FakeWorkbenchContext,
    _accepting_context,
)


@pytest.mark.asyncio
async def test_watch_requires_confirmation(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id=sample_entry,
        notification_preference="digest",
        db=test_db,
    )

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm workspace watches.",
    }
    assert (
        await OrgWatchCRUD.get(
            test_db,
            org_id="org_1",
            resource_type="entry",
            resource_id=sample_entry,
        )
        is None
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_watch_rejection_writes_nothing(
    test_db: object,
    sample_entry: str,
    action: str,
) -> None:
    ctx = FakeWorkbenchContext(action=action)

    result = await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id=sample_entry,
        notification_preference="digest",
        db=test_db,
    )

    assert result == {
        "status": action,
        "message": "No workspace watch was created.",
    }
    assert (
        await OrgWatchCRUD.get(
            test_db,
            org_id="org_1",
            resource_type="entry",
            resource_id=sample_entry,
        )
        is None
    )


@pytest.mark.asyncio
async def test_watch_unchecked_confirmation_writes_nothing(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_watch=False, notification_preference="immediate"),
    )

    result = await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id=sample_entry,
        notification_preference="digest",
        db=test_db,
    )

    assert result == {"status": "decline", "message": "No workspace watch was created."}
    assert (
        await OrgWatchCRUD.get(
            test_db,
            org_id="org_1",
            resource_type="entry",
            resource_id=sample_entry,
        )
        is None
    )


@pytest.mark.asyncio
async def test_watch_accept_creates_entry_watch(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_watch=True, notification_preference="immediate"),
    )

    result = await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id=sample_entry,
        notification_preference="digest",
        db=test_db,
    )

    watch = await OrgWatchCRUD.get(
        test_db,
        org_id="org_1",
        resource_type="entry",
        resource_id=sample_entry,
    )
    assert watch is not None
    assert result == {
        "status": "watched",
        "watch_id": watch.id,
        "resource_type": "entry",
        "resource_id": sample_entry,
        "notification_preference": "immediate",
    }


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
async def test_watch_accept_creates_coverage_target_watch(
    test_db: object,
    sample_entry: str,
) -> None:
    target_id = await _create_coverage_target(test_db, sample_entry=sample_entry)
    ctx = _accepting_context(
        SimpleNamespace(confirm_watch=True, notification_preference="immediate"),
    )

    result = await watch_workspace_resource(
        ctx,
        resource_type="coverage_target",
        resource_id=target_id,
        notification_preference="digest",
        db=test_db,
    )

    assert result["status"] == "watched"
    assert result["resource_type"] == "coverage_target"
    assert result["resource_id"] == target_id


@pytest.mark.asyncio
async def test_watch_missing_target_reports_not_found(test_db: object) -> None:
    ctx = _accepting_context(
        SimpleNamespace(confirm_watch=True, notification_preference="immediate"),
    )

    result = await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id="missing_entry",
        notification_preference="digest",
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Watch target not found."}


@pytest.mark.asyncio
async def test_watch_existing_target_does_not_record_duplicate_usage(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = _accepting_context(
        SimpleNamespace(confirm_watch=True, notification_preference="immediate"),
    )

    await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id=sample_entry,
        notification_preference="digest",
        db=test_db,
    )
    result = await watch_workspace_resource(
        ctx,
        resource_type="entry",
        resource_id=sample_entry,
        notification_preference="digest",
        db=test_db,
    )

    assert result["status"] == "watched"
    usage_events = await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0)
    assert len(usage_events) == 1
