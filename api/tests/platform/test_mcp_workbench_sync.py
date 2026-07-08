"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp.workbench import (
    sync_scout_artifacts,
)
from tests.support.mcp_workbench import (
    FakeWorkbenchContext,
    _scout_artifacts,
)


@pytest.mark.asyncio
async def test_scout_sync_requires_confirmation(test_db: object) -> None:
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await sync_scout_artifacts(
        ctx,
        artifacts=_scout_artifacts("local_unsupported"),
        db=test_db,
    )

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm Scout artifact syncs.",
    }
    runs = await DiscoveryRunCRUD.list(test_db, state=None, status=None, limit=10, offset=0)
    assert runs == []


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_scout_sync_rejection_writes_nothing(test_db: object, action: str) -> None:
    ctx = FakeWorkbenchContext(action=action)

    result = await sync_scout_artifacts(
        ctx,
        artifacts=_scout_artifacts(f"local_{action}"),
        db=test_db,
    )

    assert result == {"status": action, "message": "No Scout artifacts were synced."}
    runs = await DiscoveryRunCRUD.list(test_db, state=None, status=None, limit=10, offset=0)
    assert runs == []


@pytest.mark.asyncio
async def test_scout_sync_unchecked_confirmation_writes_nothing(test_db: object) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_sync=False,
            visibility="workspace",
            review_state="reviewed",
            source_linkage_ack=True,
        ),
    )

    result = await sync_scout_artifacts(
        ctx,
        artifacts=_scout_artifacts("local_unchecked"),
        db=test_db,
    )

    assert result == {"status": "decline", "message": "No Scout artifacts were synced."}
    runs = await DiscoveryRunCRUD.list(test_db, state=None, status=None, limit=10, offset=0)
    assert runs == []


@pytest.mark.asyncio
async def test_scout_sync_reports_unauthenticated_without_actor(
    test_db: object,
) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_sync=True,
            visibility="workspace",
            review_state="reviewed",
            source_linkage_ack=True,
        ),
        user_id=None,
    )

    result = await sync_scout_artifacts(
        ctx,
        artifacts=_scout_artifacts("local_unauthenticated"),
        db=test_db,
    )

    assert result == {
        "status": "unauthenticated",
        "message": "Atlas could not identify the MCP user.",
    }


@pytest.mark.asyncio
async def test_scout_sync_accepts_workspace_artifacts(test_db: object) -> None:
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(
            confirm_sync=True,
            visibility="workspace",
            review_state="reviewed",
            source_linkage_ack=True,
        ),
    )

    result = await sync_scout_artifacts(
        ctx,
        artifacts=_scout_artifacts("local_workspace_sync"),
        db=test_db,
    )

    assert result["status"] == "synced"
    assert result["sync_status"] == "synced"
    assert result["entries_persisted"] == 0
    ownership = await OwnershipCRUD.get_ownership(test_db, result["run_id"], "discovery_run")
    assert ownership is not None
    assert ownership.org_id == "org_1"
    assert ownership.visibility == "private"
    usage_events = await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0)
    assert [
        (event.event_type, event.resource_type, event.resource_id) for event in usage_events
    ] == [("scout_artifacts_synced", "discovery_run", result["run_id"])]
