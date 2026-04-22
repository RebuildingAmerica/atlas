"""Tests for slug generation and resolution."""

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_NOT_FOUND = 404
SLUG_HASH_LENGTH = 4


class TestSlugGeneration:
    def test_generates_slug_from_name_and_id(self) -> None:
        slug = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert slug.startswith("jane-doe-")
        assert len(slug.split("-")[-1]) == SLUG_HASH_LENGTH

    def test_strips_special_characters(self) -> None:
        slug = EntryCRUD.generate_slug(
            "Dr. María García-López (PhD)", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        )
        assert "." not in slug
        assert "(" not in slug
        assert ")" not in slug
        name_part = "-".join(slug.split("-")[:-1])
        assert all(c.isalnum() or c == "-" for c in name_part)

    def test_handles_unicode_names(self) -> None:
        slug = EntryCRUD.generate_slug("José Hernández", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert slug.startswith("jose-hernandez-")
        assert len(slug.split("-")[-1]) == SLUG_HASH_LENGTH

    def test_collapses_multiple_hyphens(self) -> None:
        slug = EntryCRUD.generate_slug("A -- B  C", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert "--" not in slug

    def test_deterministic_for_same_inputs(self) -> None:
        slug_a = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        slug_b = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert slug_a == slug_b

    def test_different_ids_produce_different_slugs(self) -> None:
        slug_a = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        slug_b = EntryCRUD.generate_slug("Jane Doe", "ffffffff-ffff-ffff-ffff-ffffffffffff")
        assert slug_a != slug_b


class TestSlugResolution:
    @pytest.mark.asyncio
    async def test_resolve_by_slug_returns_entry(self, test_db: object) -> None:
        conn = test_db
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Test person",
            city=None,
            state=None,
            geo_specificity="local",
        )
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        assert entry is not None
        assert entry.slug is not None

        resolved = await EntryCRUD.get_by_slug(conn, entry.slug)
        assert resolved is not None
        assert resolved.id == entry_id

    @pytest.mark.asyncio
    async def test_resolve_unknown_slug_returns_none(self, test_db: object) -> None:
        conn = test_db
        resolved = await EntryCRUD.get_by_slug(conn, "nonexistent-slug-xxxx")
        assert resolved is None

    @pytest.mark.asyncio
    async def test_resolve_alias_returns_entry_and_canonical(self, test_db: object) -> None:
        conn = test_db
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Test person",
            city=None,
            state=None,
            geo_specificity="local",
        )
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        assert entry is not None
        old_slug = entry.slug

        await EntryCRUD.set_vanity_slug(conn, entry_id, "janedoe")

        result = await EntryCRUD.resolve_slug(conn, old_slug)
        assert result is not None
        assert result["entry"].id == entry_id
        assert result["canonical_slug"] == "janedoe"
        assert result["is_alias"] is True

        result = await EntryCRUD.resolve_slug(conn, "janedoe")
        assert result is not None
        assert result["entry"].id == entry_id
        assert result["is_alias"] is False
