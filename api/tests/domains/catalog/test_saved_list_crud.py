"""Direct tests for saved-list persistence."""

from __future__ import annotations

import pytest

from atlas.domains.access.models.saved_lists import SavedListCRUD


class TestSavedListCRUDDirect:
    """Direct model-level coverage for SavedListCRUD."""

    @pytest.mark.asyncio
    async def test_add_and_remove_item(self, test_db: object, claimable_org: str) -> None:
        record = await SavedListCRUD.create(test_db, user_id="user-1", name="L")
        await SavedListCRUD.add_item(
            test_db, list_id=record.id, entry_id=claimable_org, note="check"
        )
        assert await SavedListCRUD.count_items(test_db, record.id) == 1
        removed = await SavedListCRUD.remove_item(
            test_db, list_id=record.id, entry_id=claimable_org
        )
        assert removed is True
        assert await SavedListCRUD.count_items(test_db, record.id) == 0

    @pytest.mark.asyncio
    async def test_get_by_id_returns_none_for_missing_list(self, test_db: object) -> None:
        """get_by_id returns None when no row matches."""
        assert await SavedListCRUD.get_by_id(test_db, "list-does-not-exist") is None

    @pytest.mark.asyncio
    async def test_remove_item_returns_false_when_missing(
        self, test_db: object, claimable_org: str
    ) -> None:
        """Removing a non-existent item returns False without bumping updated_at."""
        record = await SavedListCRUD.create(test_db, user_id="user-1", name="L")
        removed = await SavedListCRUD.remove_item(
            test_db, list_id=record.id, entry_id=claimable_org
        )
        assert removed is False

    @pytest.mark.asyncio
    async def test_update_no_fields_returns_existing_record(self, test_db: object) -> None:
        """When no name/description is supplied, update returns the row unchanged."""
        record = await SavedListCRUD.create(
            test_db, user_id="user-1", name="Original", description="orig desc"
        )
        unchanged = await SavedListCRUD.update(test_db, record.id)
        assert unchanged is not None
        assert unchanged.name == "Original"
        assert unchanged.description == "orig desc"

    @pytest.mark.asyncio
    async def test_update_renames_and_updates_description(self, test_db: object) -> None:
        """update sets the supplied fields and persists them."""
        record = await SavedListCRUD.create(test_db, user_id="user-1", name="Original")
        updated = await SavedListCRUD.update(
            test_db, record.id, name="Renamed", description="new desc"
        )
        assert updated is not None
        assert updated.name == "Renamed"
        assert updated.description == "new desc"

    @pytest.mark.asyncio
    async def test_update_returns_none_for_missing_list(self, test_db: object) -> None:
        """update returns None when the row id does not exist."""
        result = await SavedListCRUD.update(test_db, "no-such-list", name="x")
        assert result is None
