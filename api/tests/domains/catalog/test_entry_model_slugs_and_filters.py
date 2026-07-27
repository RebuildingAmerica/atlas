"""Coverage-driven tests for atlas.domains.catalog.models.entry."""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from tests.support.schema_introspection import with_foreign_keys_disabled

_MAX_REVIEWABLE_ENTRY_MODULE_LINES = 1000


def test_entry_model_module_stays_reviewable() -> None:
    """The public entry model module should stay small enough to audit trust-critical behavior."""
    source_file = inspect.getsourcefile(EntryCRUD)
    assert source_file is not None
    module_path = Path(source_file)

    assert len(module_path.read_text().splitlines()) < _MAX_REVIEWABLE_ENTRY_MODULE_LINES


@pytest.mark.asyncio
async def test_resolve_slug_alias_pointing_at_missing_entry_returns_none(
    test_db: object,
) -> None:
    """An alias row whose entry has been deleted should resolve to None (line 353).

    Uses ``ON DELETE CASCADE`` semantics: temporarily disabling FK enforcement
    is the only way to leave an orphan alias because production cascades wipe
    them on delete.
    """
    conn = test_db
    async with with_foreign_keys_disabled(conn, "slug_aliases"):
        await conn.execute(
            "INSERT INTO slug_aliases (old_slug, entry_id) VALUES (?, ?)",
            ("orphan-alias", "nonexistent-entry-id"),
        )
        await conn.commit()

    result = await EntryCRUD.resolve_slug(conn, "orphan-alias")
    assert result is None


@pytest.mark.asyncio
async def test_set_vanity_slug_returns_false_for_missing_entry(test_db: object) -> None:
    """set_vanity_slug should return False when the entry id does not exist (line 379)."""
    ok = await EntryCRUD.set_vanity_slug(test_db, "missing-entry-id", "any-slug")
    assert ok is False


@pytest.mark.asyncio
async def test_set_vanity_slug_returns_true_for_unchanged_slug(test_db: object) -> None:
    """If the requested slug equals the current slug, return True without writes (line 383)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Same Slug",
        description="Re-applies its own slug.",
        city=None,
        state=None,
        geo_specificity="local",
    )
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None
    assert entry.slug is not None

    ok = await EntryCRUD.set_vanity_slug(conn, entry_id, entry.slug)
    assert ok is True

    cursor = await conn.execute("SELECT COUNT(*) FROM slug_aliases WHERE entry_id = ?", (entry_id,))
    row = await cursor.fetchone()
    assert row[0] == 0


@pytest.mark.asyncio
async def test_set_vanity_slug_skips_alias_when_old_slug_is_null(test_db: object) -> None:
    """When the existing slug is NULL the alias-insert branch is skipped (385->391)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="No Slug",
        description="Has no original slug.",
        city=None,
        state=None,
        geo_specificity="local",
    )
    await conn.execute("UPDATE entries SET slug = NULL WHERE id = ?", (entry_id,))
    await conn.commit()

    ok = await EntryCRUD.set_vanity_slug(conn, entry_id, "fresh-vanity")
    assert ok is True

    refreshed = await EntryCRUD.get_by_id(conn, entry_id)
    assert refreshed is not None
    assert refreshed.slug == "fresh-vanity"

    cursor = await conn.execute("SELECT COUNT(*) FROM slug_aliases WHERE entry_id = ?", (entry_id,))
    row = await cursor.fetchone()
    assert row[0] == 0


@pytest.mark.asyncio
async def test_list_filters_by_entry_type(test_db: object) -> None:
    """list() should accept an entry_type filter (lines 445-446)."""
    conn = test_db
    await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Filter Person",
        description="A person entry for type-filter coverage.",
        city="Topeka",
        state="KS",
        geo_specificity="local",
    )
    await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Filter Org",
        description="An organization entry for type-filter coverage.",
        city="Topeka",
        state="KS",
        geo_specificity="local",
    )

    people = await EntryCRUD.list(conn, entry_type="person")
    assert len(people) >= 1
    assert all(entry.type == "person" for entry in people)


@pytest.mark.asyncio
async def test_search_fts_returns_matching_entries(test_db: object) -> None:
    """search_fts should return entries whose name/description match (lines 483-503)."""
    conn = test_db
    await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Riverstone Housing Coalition",
        description="A civic group focused on local housing equity.",
        city="Lawrence",
        state="KS",
        geo_specificity="local",
    )

    matches = await EntryCRUD.search_fts(conn, "Riverstone")
    assert any(e.name == "Riverstone Housing Coalition" for e in matches)


@pytest.mark.asyncio
async def test_search_fts_returns_empty_for_no_matches(test_db: object) -> None:
    """search_fts should return [] when nothing matches (line 499-500)."""
    conn = test_db
    matches = await EntryCRUD.search_fts(conn, "absolutelynothingmatchesthis")
    assert matches == []


@pytest.mark.asyncio
async def test_filter_by_issue_area_returns_tagged_entries(test_db: object) -> None:
    """filter_by_issue_area should return entries tagged with the slug (lines 534-555)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Issue Area Org",
        description="Organization tagged with an issue area.",
        city="Wichita",
        state="KS",
        geo_specificity="local",
    )
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
        "VALUES (?, ?, CURRENT_TIMESTAMP)",
        (entry_id, "housing_affordability"),
    )
    await conn.commit()

    tagged = await EntryCRUD.filter_by_issue_area(conn, "housing_affordability", state="KS")
    assert any(e.id == entry_id for e in tagged)


@pytest.mark.asyncio
async def test_filter_by_issue_area_returns_empty_when_no_matches(test_db: object) -> None:
    """filter_by_issue_area should return [] when no entry is tagged (line 551-552)."""
    conn = test_db
    result = await EntryCRUD.filter_by_issue_area(conn, "nonexistent_issue_area")
    assert result == []


@pytest.mark.asyncio
async def test_update_returns_false_when_no_allowed_fields_provided(test_db: object) -> None:
    """update() should return False if kwargs contain no allowed fields (line 611)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="No Update",
        description="Entry that receives a no-op update.",
        city=None,
        state=None,
        geo_specificity="local",
    )

    ok = await EntryCRUD.update(conn, entry_id, not_a_real_field="nope")
    assert ok is False


@pytest.mark.asyncio
async def test_update_encodes_social_media_dict(test_db: object) -> None:
    """update() should JSON-encode social_media when provided as dict (line 617)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Social Update",
        description="Entry whose social media will be updated.",
        city=None,
        state=None,
        geo_specificity="local",
    )

    ok = await EntryCRUD.update(
        conn,
        entry_id,
        social_media={"twitter": "@updated"},
    )
    assert ok is True

    refreshed = await EntryCRUD.get_by_id(conn, entry_id)
    assert refreshed is not None
    assert refreshed.social_media == {"twitter": "@updated"}


@pytest.mark.asyncio
async def test_update_rejects_non_iterable_suppressed_source_ids(test_db: object) -> None:
    """update() should raise TypeError for non-iterable suppressed_source_ids (lines 622-623)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Type Check",
        description="Entry used to check suppressed_source_ids type validation.",
        city=None,
        state=None,
        geo_specificity="local",
    )

    with pytest.raises(TypeError, match="suppressed_source_ids"):
        await EntryCRUD.update(conn, entry_id, suppressed_source_ids=12345)


@pytest.mark.asyncio
async def test_update_clears_suppressed_source_ids_when_empty(test_db: object) -> None:
    """update() should write NULL when suppressed_source_ids is empty (line 626)."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Clear Suppressed",
        description="Entry whose suppressed_source_ids list will be cleared.",
        city=None,
        state=None,
        geo_specificity="local",
    )
    await EntryCRUD.update(conn, entry_id, suppressed_source_ids=["src-1", "src-2"])
    seeded = await EntryCRUD.get_by_id(conn, entry_id)
    assert seeded is not None
    assert seeded.suppressed_source_ids == ["src-1", "src-2"]

    ok = await EntryCRUD.update(conn, entry_id, suppressed_source_ids=[])
    assert ok is True

    cleared = await EntryCRUD.get_by_id(conn, entry_id)
    assert cleared is not None
    assert cleared.suppressed_source_ids == []


@pytest.mark.asyncio
async def test_update_serializes_last_verified_date(test_db: object) -> None:
    """update() should convert a date to isoformat for last_verified (line 629)."""
    from datetime import date

    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Date Update",
        description="Entry whose last_verified is updated as a date object.",
        city=None,
        state=None,
        geo_specificity="local",
    )

    ok = await EntryCRUD.update(conn, entry_id, last_verified=date(2026, 4, 30))
    assert ok is True

    refreshed = await EntryCRUD.get_by_id(conn, entry_id)
    assert refreshed is not None
    assert refreshed.last_verified == date(2026, 4, 30)


@pytest.mark.asyncio
async def test_get_issue_areas_for_entries_returns_empty_for_empty_input(
    test_db: object,
) -> None:
    """get_issue_areas_for_entries should short-circuit on empty list (line 756)."""
    result = await EntryCRUD.get_issue_areas_for_entries(test_db, [])
    assert result == {}


@pytest.mark.asyncio
async def test_get_sources_for_entries_returns_empty_for_empty_input(
    test_db: object,
) -> None:
    """get_sources_for_entries should short-circuit on empty list (line 795)."""
    result = await EntryCRUD.get_sources_for_entries(test_db, [])
    assert result == {}
