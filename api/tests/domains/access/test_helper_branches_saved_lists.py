"""Tests for access helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api import lists as lists_api
from atlas.domains.access.models.saved_lists import SavedListModel
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.schemas.public import SavedListItemRequest


class TestSavedLists:
    """Saved-list helper branches."""

    def test_entry_location_uses_display_city_and_state(self) -> None:
        """Export rows should use the most honest available location string."""
        assert lists_api._entry_location(None) == ""
        assert (
            lists_api._entry_location(
                SimpleNamespace(
                    address=SimpleNamespace(display="Downtown", city="Kansas City", state="MO")
                )
            )
            == "Downtown"
        )
        assert (
            lists_api._entry_location(
                SimpleNamespace(address=SimpleNamespace(display="", city="Kansas City", state="MO"))
            )
            == "Kansas City, MO"
        )

    @pytest.mark.asyncio
    async def test_export_list_rejects_missing_list(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Missing saved lists should return a 404 before export work starts."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id=None,
            active_products=["atlas_team"],
        )
        response = Response()
        monkeypatch.setattr(lists_api.SavedListCRUD, "get_by_id", AsyncMock(return_value=None))

        with pytest.raises(HTTPException, match="List not found"):
            await lists_api.export_list(
                "missing-list",
                response=response,
                export_format="json",
                actor=actor,
                db=AsyncMock(),
            )

    @pytest.mark.asyncio
    async def test_add_item_records_workspace_usage_on_first_save(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The first saved list item should emit a workspace usage event."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id="org-1",
            active_products=["atlas_team"],
        )
        saved_list = SavedListModel(
            id="list-1",
            user_id="user-1",
            name="Neighborhood Leads",
            description=None,
            created_at="2026-07-05T00:00:00Z",
            updated_at="2026-07-05T00:00:00Z",
        )
        item = SimpleNamespace(
            list_id="list-1",
            entry_id="entry-1",
            note="call soon",
            added_at="2026-07-05T00:00:00Z",
        )
        record_mock = AsyncMock()

        monkeypatch.setattr(
            lists_api.SavedListCRUD, "get_by_id", AsyncMock(return_value=saved_list)
        )
        monkeypatch.setattr(
            lists_api.EntryCRUD, "get_by_id", AsyncMock(return_value=SimpleNamespace(id="entry-1"))
        )
        monkeypatch.setattr(lists_api.SavedListCRUD, "add_item", AsyncMock(return_value=item))
        monkeypatch.setattr(lists_api.OrgUsageEventCRUD, "record", record_mock)
        monkeypatch.setattr(lists_api, "_hydrate_entry", AsyncMock(return_value=None))

        response = await lists_api.add_item(
            "list-1",
            SavedListItemRequest(entry_id="entry-1", note="call soon"),
            response=Response(),
            actor=actor,
            db=AsyncMock(),
        )

        assert response.entry is None
        assert record_mock.await_count == 1
        assert record_mock.await_args.args[1].event_type == "list_item_saved"

    @pytest.mark.asyncio
    async def test_add_item_skips_workspace_usage_without_org(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Personal saved lists should not emit workspace usage rows."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
        )
        saved_list = SavedListModel(
            id="list-1",
            user_id="user-1",
            name="Neighborhood Leads",
            description=None,
            created_at="2026-07-05T00:00:00Z",
            updated_at="2026-07-05T00:00:00Z",
        )
        item = SimpleNamespace(
            list_id="list-1",
            entry_id="entry-1",
            note=None,
            added_at="2026-07-05T00:00:00Z",
        )
        record_mock = AsyncMock()

        monkeypatch.setattr(
            lists_api.SavedListCRUD, "get_by_id", AsyncMock(return_value=saved_list)
        )
        monkeypatch.setattr(
            lists_api.EntryCRUD, "get_by_id", AsyncMock(return_value=SimpleNamespace(id="entry-1"))
        )
        monkeypatch.setattr(lists_api.SavedListCRUD, "add_item", AsyncMock(return_value=item))
        monkeypatch.setattr(lists_api.OrgUsageEventCRUD, "record", record_mock)
        monkeypatch.setattr(lists_api, "_hydrate_entry", AsyncMock(return_value=None))

        response = await lists_api.add_item(
            "list-1",
            SavedListItemRequest(entry_id="entry-1", note=None),
            response=Response(),
            actor=actor,
            db=AsyncMock(),
        )

        assert response.entry is None
        assert record_mock.await_count == 0
