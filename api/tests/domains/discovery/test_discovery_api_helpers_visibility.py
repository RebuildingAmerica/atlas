"""Tests for discovery API helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api as discovery_api
from atlas.models import EntryCRUD


@pytest.mark.asyncio
async def test_sync_entry_visibility_handles_public_and_workspace_paths(
    test_db: object,
) -> None:
    """Sync visibility should preserve public entries and private workspace receipts."""
    actor = SimpleNamespace(user_id="local-user")
    entry_id = "entry-1"

    with patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=True)):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id=entry_id,
                workspace_id=None,
                actor=actor,
            )
            == "public"
        )

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="local", visibility="private")),
        ),
    ):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id=entry_id,
                workspace_id="local",
                actor=actor,
            )
            == "workspace_private"
        )


@pytest.mark.asyncio
async def test_sync_entry_visibility_covers_existing_shared_and_review_paths(
    test_db: object,
) -> None:
    """Workspace syncs should distinguish shared and review-only receipts."""
    actor = SimpleNamespace(user_id="local-user")

    with patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=True)):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id="entry-1",
                workspace_id="local",
                actor=actor,
            )
            == "existing_shared"
        )

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="local", visibility="public")),
        ),
    ):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id="entry-2",
                workspace_id="local",
                actor=actor,
            )
            == "held_for_review"
        )


@pytest.mark.asyncio
async def test_sync_entry_visibility_rejects_foreign_private_receipts(
    test_db: object,
) -> None:
    """Private entries should not be silently reassigned to another workspace."""
    actor = SimpleNamespace(user_id="local-user")

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="other", visibility="private")),
        ),
        pytest.raises(HTTPException) as exc_info,
    ):
        await discovery_api._sync_entry_visibility(
            test_db,
            entry_id="entry-2",
            workspace_id="local",
            actor=actor,
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_sync_entry_visibility_creates_workspace_ownership_for_new_private_entries(
    test_db: object,
) -> None:
    """New private entries should be attached to the workspace explicitly."""
    actor = SimpleNamespace(user_id="local-user")
    create_mock = AsyncMock()

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(OwnershipCRUD, "get_ownership", AsyncMock(return_value=None)),
        patch.object(OwnershipCRUD, "create_ownership", create_mock),
    ):
        result = await discovery_api._sync_entry_visibility(
            test_db,
            entry_id="entry-3",
            workspace_id="local",
            actor=actor,
        )

    assert result == "workspace_private"
    create_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_ensure_workspace_run_ownership_rejects_foreign_workspace(
    test_db: object,
) -> None:
    """A synced run should stay attached to its original workspace."""
    actor = SimpleNamespace(user_id="local-user")

    with (
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="other")),
        ),
        pytest.raises(HTTPException) as exc_info,
    ):
        await discovery_api._ensure_workspace_run_ownership(
            test_db,
            run_id="run-1",
            workspace_id="local",
            actor=actor,
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_ensure_workspace_run_ownership_returns_when_workspace_matches(
    test_db: object,
) -> None:
    """Already-owned runs should pass through without creating another receipt."""
    actor = SimpleNamespace(user_id="local-user")
    create_mock = AsyncMock()

    with (
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="local")),
        ),
        patch.object(OwnershipCRUD, "create_ownership", create_mock),
    ):
        await discovery_api._ensure_workspace_run_ownership(
            test_db,
            run_id="run-1",
            workspace_id="local",
            actor=actor,
        )

    create_mock.assert_not_called()
