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
from atlas.platform.mcp import workbench as workbench_module
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
    def __init__(
        self,
        *,
        action: str,
        content: object | None = None,
        form: bool = True,
        user_id: str | None = "user_1",
        org_id: str | None = "org_1",
    ) -> None:
        meta = _elicitation_meta() if form else {}
        auth_payload = {"sub": user_id, "org_id": org_id}
        self.request_context = SimpleNamespace(
            meta=meta,
            request=SimpleNamespace(state=SimpleNamespace(mcp_auth_payload=auth_payload)),
        )
        self.action = action
        self.content = content
        self.calls: list[dict[str, object]] = []

    async def elicit(self, *, message: str, schema: type[object]) -> object:
        self.calls.append({"message": message, "schema": schema})
        return SimpleNamespace(action=self.action, data=self.content)


class FakeWorkbenchContextWithBrokenMeta:
    @property
    def request_context(self) -> object:
        raise ValueError


class FakeWorkbenchContextWithBrokenRequest:
    class RequestContext:
        meta = _elicitation_meta()

        @property
        def request(self) -> object:
            raise ValueError

    request_context = RequestContext()


class FakeConnection:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def _accepting_context(content: object) -> FakeWorkbenchContext:
    return FakeWorkbenchContext(action="accept", content=content)


def _all_confirmation_content() -> SimpleNamespace:
    return SimpleNamespace(
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


@pytest.mark.asyncio
async def test_save_list_reports_unavailable_without_active_context() -> None:
    result = await save_entities_to_list(
        FakeWorkbenchContextWithBrokenMeta(),
        list_id="list_1",
        entry_ids=["entry_1"],
    )

    assert result == {
        "status": "unsupported",
        "message": "This MCP client cannot confirm saved-list writes.",
    }


def test_workbench_context_helpers_handle_missing_context() -> None:
    assert workbench_module._request_meta_from_context(None) is None  # noqa: SLF001
    assert workbench_module._request_meta_from_context(FakeWorkbenchContextWithBrokenMeta()) is None  # noqa: SLF001
    assert workbench_module._actor_claims_from_context(None) == (None, None)  # noqa: SLF001
    assert workbench_module._actor_claims_from_context(  # noqa: SLF001
        FakeWorkbenchContextWithBrokenRequest()
    ) == (None, None)


@pytest.mark.asyncio
async def test_save_list_reports_unauthenticated_without_actor(
    test_db: object,
    sample_entry: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_save=True, visibility="private", source_linkage_ack=True),
        user_id=None,
    )

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result == {
        "status": "unauthenticated",
        "message": "Atlas could not identify the MCP user.",
    }


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
async def test_save_list_unchecked_confirmation_writes_nothing(
    test_db: object,
    sample_entry: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_save=False, visibility="private", source_linkage_ack=True),
    )

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result == {"status": "decline", "message": "No actors were saved to the list."}
    assert await SavedListCRUD.count_items(test_db, saved_list.id) == 0


@pytest.mark.asyncio
async def test_save_list_missing_list_reports_not_found(
    test_db: object,
    sample_entry: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_2", name="Elsewhere")
    ctx = _accepting_context(
        SimpleNamespace(confirm_save=True, visibility="private", source_linkage_ack=True),
    )

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result == {"status": "not_found", "message": "List not found."}


@pytest.mark.asyncio
async def test_save_list_skips_missing_entries(
    test_db: object,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = _accepting_context(
        SimpleNamespace(confirm_save=True, visibility="private", source_linkage_ack=True),
    )

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=["missing_entry"],
        note="review",
        db=test_db,
    )

    assert result["status"] == "saved"
    assert result["saved_count"] == 0
    assert result["entry_ids"] == []


@pytest.mark.asyncio
async def test_save_list_without_workspace_saves_without_usage_event(
    test_db: object,
    sample_entry: str,
) -> None:
    saved_list = await SavedListCRUD.create(test_db, user_id="user_1", name="Follow-up")
    ctx = FakeWorkbenchContext(
        action="accept",
        content=SimpleNamespace(confirm_save=True, visibility="private", source_linkage_ack=True),
        org_id=None,
    )

    result = await save_entities_to_list(
        ctx,
        list_id=saved_list.id,
        entry_ids=[sample_entry],
        note="review",
        db=test_db,
    )

    assert result["status"] == "saved"
    assert result["saved_count"] == 1
    assert await OrgUsageEventCRUD.list_by_org(test_db, org_id="org_1", limit=10, offset=0) == []


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
    ("function_name", "call_kwargs", "message"),
    [
        (
            "save_entities_to_list",
            {"list_id": "list_1", "entry_ids": ["entry_1"]},
            "Atlas could not confirm this workspace action.",
        ),
        (
            "watch_workspace_resource",
            {"resource_type": "entry", "resource_id": "entry_1"},
            "Atlas could not confirm this workspace action.",
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
            "Atlas could not confirm this workspace action.",
        ),
        (
            "create_research_brief",
            {
                "title": "Kansas City housing brief",
                "scope": {"geography": "Kansas City, MO"},
                "summary": "One source-backed housing lead is ready for review.",
                "linked_entry_ids": ["entry_1"],
            },
            "Atlas could not confirm this workspace action.",
        ),
        (
            "export_coverage_report",
            {},
            "Atlas could not confirm this workspace action.",
        ),
        (
            "sync_scout_artifacts",
            {"artifacts": _scout_artifacts("local_missing_context")},
            "Atlas could not confirm this workspace action.",
        ),
        (
            "export_research_brief",
            {"brief_id": "brief_1"},
            "Atlas could not confirm this workspace action.",
        ),
    ],
)
async def test_workbench_handoffs_report_unavailable_when_context_missing(
    monkeypatch: pytest.MonkeyPatch,
    function_name: str,
    call_kwargs: dict[str, object],
    message: str,
) -> None:
    def fake_declares_form_elicitation(_meta: object) -> bool:
        return True

    monkeypatch.setattr(
        workbench_module, "declares_form_elicitation", fake_declares_form_elicitation
    )

    result = await getattr(workbench_module, function_name)(None, **call_kwargs)

    assert result == {"status": "unavailable", "message": message}


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
