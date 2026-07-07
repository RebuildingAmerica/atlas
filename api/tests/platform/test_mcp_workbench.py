"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoverySyncInfo,
)

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.access.models.watches import OrgWatchCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp.elicitation import CLIENT_CAPABILITIES_META_KEY
from atlas.platform.mcp.workbench import (
    create_coverage_target,
    create_research_brief,
    export_coverage_report,
    export_research_brief,
    save_entities_to_list,
    sync_scout_artifacts,
    watch_workspace_resource,
)


def _elicitation_meta() -> dict[str, Any]:
    return {CLIENT_CAPABILITIES_META_KEY: {"elicitation": {"form": {}}}}


class FakeWorkbenchContext:
    def __init__(self, *, action: str, content: object | None = None, form: bool = True) -> None:
        meta = _elicitation_meta() if form else {}
        self.request_context = SimpleNamespace(
            meta=meta,
            request=SimpleNamespace(
                state=SimpleNamespace(mcp_auth_payload={"sub": "user_1", "org_id": "org_1"})
            ),
        )
        self.action = action
        self.content = content
        self.calls: list[dict[str, object]] = []

    async def elicit(self, *, message: str, schema: type[object]) -> object:
        self.calls.append({"message": message, "schema": schema})
        return SimpleNamespace(action=self.action, data=self.content)


@pytest.mark.asyncio
async def test_save_list_requires_confirmation(
    test_db: object,
    sample_entry: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = FakeWorkbenchContext(action="accept", form=False)

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm saved-list writes.",
    }
    assert await SavedListCRUD.count_items(test_db, saved_list.id) == 0
    assert ctx.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_save_list_rejection_writes_nothing(
    test_db: object,
    sample_entry: str,
    action: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = FakeWorkbenchContext(action=action)

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result == {
        "status": action,
        "message": "No actors were saved to the list.",
    }
    assert await SavedListCRUD.count_items(test_db, saved_list.id) == 0


@pytest.mark.asyncio
async def test_save_list_accept_saves_entries(
    test_db: object,
    sample_entry: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_save=True, visibility="private", source_linkage_ack=True),
    )

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result == {
        "status": "saved",
        "list_id": saved_list.id,
        "saved_count": 1,
        "entry_ids": [sample_entry],
        "visibility": "private",
    }
    items = await SavedListCRUD.list_items(test_db, saved_list.id)
    assert [item.entry_id for item in items] == [sample_entry]
    assert items[0].note == "review"


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


def _scout_artifacts(local_run_id: str) -> DiscoveryRunArtifacts:
    return DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Wichita, KS",
                state="KS",
                issue_areas=["worker_cooperatives"],
            ),
            status="completed",
            sync=DiscoverySyncInfo(local_run_id=local_run_id, sync_status="ready"),
        ),
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=0,
            sources_processed=0,
            entries_extracted=0,
            entries_after_dedup=0,
            entries_confirmed=0,
        ),
        sources=[],
        ranked_entries=[],
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
async def test_export_brief_accept_returns_export(
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
        content=SimpleNamespace(confirm_export=True, format="json", source_linkage_ack=True),
    )

    result = await export_research_brief(ctx, brief_id=brief_id, db=test_db)

    assert result["status"] == "exported"
    assert result["format"] == "json"
    assert result["brief"]["id"] == brief_id
    assert result["brief"]["title"] == "Kansas City housing brief"
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
