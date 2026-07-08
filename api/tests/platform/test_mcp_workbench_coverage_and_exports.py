"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.platform.mcp.workbench import (
    create_coverage_target,
)
from tests.support.mcp_workbench import (
    FakeWorkbenchContext,
    _accepting_context,
)


@pytest.mark.asyncio
async def test_coverage_target_requires_confirmation(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await create_coverage_target(
        ctx,
        name="Kansas City tenant power",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_entry_ids=[sample_entry],
        db=test_db,
    )

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm coverage-target writes.",
    }
    assert await CoverageTargetCRUD.list_by_org(test_db, "org_1") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_coverage_target_rejection_writes_nothing(
    test_db: object,
    sample_entry: str,
    action: str,
) -> None:
    ctx = FakeWorkbenchContext(action=action)

    result = await create_coverage_target(
        ctx,
        name="Kansas City tenant power",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_entry_ids=[sample_entry],
        db=test_db,
    )

    assert result == {
        "status": action,
        "message": "No coverage target was created.",
    }
    assert await CoverageTargetCRUD.list_by_org(test_db, "org_1") == []


@pytest.mark.asyncio
async def test_coverage_target_unchecked_confirmation_writes_nothing(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_create=False,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Kansas City tenant power",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_entry_ids=[sample_entry],
        db=test_db,
    )

    assert result == {"status": "decline", "message": "No coverage target was created."}
    assert await CoverageTargetCRUD.list_by_org(test_db, "org_1") == []


@pytest.mark.asyncio
async def test_coverage_target_rejects_unknown_issue_area(test_db: object) -> None:
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Unknown issue",
        geography="Kansas City, MO",
        issue_areas=["unknown_issue"],
        actor_types=["organization"],
        source_types=["community_archive"],
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Coverage target evidence was not found."}


@pytest.mark.asyncio
async def test_coverage_target_rejects_missing_linked_run(test_db: object) -> None:
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Missing run",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_discovery_run_ids=["missing_run"],
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Coverage target evidence was not found."}


@pytest.mark.asyncio
async def test_coverage_target_rejects_linked_run_owned_by_other_org(
    test_db: object,
    sample_discovery_run: str,
) -> None:
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=sample_discovery_run,
        resource_type="discovery_run",
        org_id="org_2",
        visibility="private",
        created_by="user_2",
    )
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Other org run",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_discovery_run_ids=[sample_discovery_run],
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Coverage target evidence was not found."}


@pytest.mark.asyncio
async def test_coverage_target_accepts_linked_run_owned_by_workspace(
    test_db: object,
    sample_discovery_run: str,
) -> None:
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=sample_discovery_run,
        resource_type="discovery_run",
        org_id="org_1",
        visibility="private",
        created_by="user_1",
    )
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Owned run",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_discovery_run_ids=[sample_discovery_run],
        db=test_db,
    )

    assert result["status"] == "created"
    assert result["linked_discovery_run_ids"] == [sample_discovery_run]


@pytest.mark.asyncio
async def test_coverage_target_rejects_missing_linked_entry(test_db: object) -> None:
    ctx = _accepting_context(
        SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Missing entry",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_entry_ids=["missing_entry"],
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "Coverage target evidence was not found."}


@pytest.mark.asyncio
async def test_coverage_target_accept_creates_target(
    test_db: object,
    sample_entry: str,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_create=True,
            visibility="workspace",
            review_state="in_review",
            source_linkage_ack=True,
        ),
    )

    result = await create_coverage_target(
        ctx,
        name="Kansas City tenant power",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        linked_entry_ids=[sample_entry],
        gaps=[{"label": "County tenant groups", "detail": "Review county coverage."}],
        next_actions=["Review county source coverage"],
        db=test_db,
    )

    targets = await CoverageTargetCRUD.list_by_org(test_db, "org_1")
    assert len(targets) == 1
    target = targets[0]
    assert result == {
        "status": "created",
        "target_id": target.id,
        "name": "Kansas City tenant power",
        "geography": "Kansas City, MO",
        "issue_areas": ["housing_affordability"],
        "actor_types": ["organization"],
        "source_types": ["community_archive"],
        "review_state": "in_review",
        "coverage_status": "thin",
        "linked_entry_ids": [sample_entry],
        "linked_discovery_run_ids": [],
        "visibility": "workspace",
    }
    assert target.created_by == "user_1"
    assert target.gaps == [{"label": "County tenant groups", "detail": "Review county coverage."}]
    usage_events = await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0)
    assert [
        (event.event_type, event.resource_type, event.resource_id) for event in usage_events
    ] == [("coverage_target_created", "coverage_target", target.id)]
    assert usage_events[0].metadata_json == "{}"
