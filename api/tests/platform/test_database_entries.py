"""Database and CRUD tests."""

from __future__ import annotations

import pytest

from atlas.models import EntryCRUD


class TestEntryModel:
    """Tests for Entry model and CRUD."""

    @pytest.mark.asyncio
    async def test_create_entry(self, test_db: object) -> None:
        """Test creating an entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Test Org",
            description="Test description.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        assert entry_id is not None

    @pytest.mark.asyncio
    async def test_get_entry(self, test_db: object, sample_entry: object) -> None:
        """Test retrieving an entry."""
        entry = await EntryCRUD.get_by_id(test_db, sample_entry)
        assert entry is not None
        assert entry.name == "Test Organization"
        assert entry.state == "MO"

    @pytest.mark.asyncio
    async def test_list_entries(self, test_db: object, sample_entry: object) -> None:
        """Test listing entries."""
        entries = await EntryCRUD.list(test_db, state="MO")
        assert len(entries) >= 1
        assert any(e.id == sample_entry for e in entries)

    @pytest.mark.asyncio
    async def test_filter_by_state(self, test_db: object, sample_entry: object) -> None:
        """Test filtering entries by state."""
        entries = await EntryCRUD.list(test_db, state="MO")
        assert len(entries) >= 1
        assert sample_entry in [e.id for e in entries]
        assert all(e.state == "MO" for e in entries)

    @pytest.mark.asyncio
    async def test_update_entry(self, test_db: object, sample_entry: object) -> None:
        """Test updating an entry."""
        success = await EntryCRUD.update(
            test_db,
            sample_entry,
            name="Updated Name",
            verified=True,
        )
        assert success

        entry = await EntryCRUD.get_by_id(test_db, sample_entry)
        assert entry is not None
        assert entry.name == "Updated Name"
        assert entry.verified is True

    @pytest.mark.asyncio
    async def test_delete_entry(self, test_db: object) -> None:
        """Test deleting an entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="To Delete",
            description="Will be deleted.",
            city="Test City",
            state="KS",
            geo_specificity="local",
        )

        success = await EntryCRUD.delete(test_db, entry_id)
        assert success

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is None

    @pytest.mark.asyncio
    async def test_entry_with_social_media(self, test_db: object) -> None:
        """Test creating entry with social media."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="Social Media Person",
            description="Has social media.",
            city="NYC",
            state="NY",
            geo_specificity="local",
            social_media={"twitter": "@user", "facebook": "user.page"},
        )

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is not None
        assert entry.social_media == {"twitter": "@user", "facebook": "user.page"}

    @pytest.mark.asyncio
    async def test_entry_with_full_address(self, test_db: object) -> None:
        """Test creating an organization entry with a full address."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Addressable Org",
            description="Has a public mailing address.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            full_address="123 Main St, Kansas City, MO 64106",
        )

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is not None
        assert entry.full_address == "123 Main St, Kansas City, MO 64106"

    @pytest.mark.asyncio
    async def test_entry_to_dict_can_hide_internal_fields(self, test_db: object) -> None:
        """Public entry serialization should omit internal editorial fields when requested."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Public View Org",
            description="Used to verify public Atlas serialization.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            editorial_notes="For staff only.",
            priority="high",
        )

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is not None

        public_record = entry.to_dict(include_internal=False)

        assert "contact_status" not in public_record
        assert "editorial_notes" not in public_record
        assert "priority" not in public_record

    @pytest.mark.asyncio
    async def test_list_entries_can_filter_by_city_without_state(self, test_db: object) -> None:
        """City-only filtering should work without requiring a state filter."""
        kansas_city_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Kansas City Housing Org",
            description="Kansas City org.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        st_louis_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="St. Louis Housing Org",
            description="St. Louis org.",
            city="St. Louis",
            state="MO",
            geo_specificity="local",
        )

        entries = await EntryCRUD.list(test_db, city="Kansas City")

        entry_ids = {entry.id for entry in entries}
        assert kansas_city_id in entry_ids
        assert st_louis_id not in entry_ids
