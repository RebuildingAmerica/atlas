"""Tests for MCP Workbench write handoffs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.platform.mcp import workbench as workbench_module
from atlas.platform.mcp.workbench import (
    save_entities_to_list,
)
from tests.support.mcp_workbench import (
    FakeWorkbenchContext,
    FakeWorkbenchContextWithBrokenMeta,
    FakeWorkbenchContextWithBrokenRequest,
    _accepting_context,
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
