"""Coverage-driven tests for atlas.domains.catalog.models.entry.

These tests fill in the remaining gaps in EntryCRUD and the row/coercer
helpers, exercising filter branches, edge-case inputs, and helper
functions directly.
"""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.entry import (
    EntryCRUD,
    _row_to_entry,
)
from atlas.models import EntryCRUD as EntryCRUDExport
from atlas.models import SourceCRUD


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
    # Disable FK enforcement just long enough to insert an orphan alias row.
    await conn.execute("PRAGMA foreign_keys = OFF")
    try:
        await conn.execute(
            "INSERT INTO slug_aliases (old_slug, entry_id) VALUES (?, ?)",
            ("orphan-alias", "nonexistent-entry-id"),
        )
        await conn.commit()
    finally:
        await conn.execute("PRAGMA foreign_keys = ON")

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

    # No alias row should have been written for the no-op case.
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
    # Manually clear the slug so old_slug is None at vanity-set time.
    await conn.execute("UPDATE entries SET slug = NULL WHERE id = ?", (entry_id,))
    await conn.commit()

    ok = await EntryCRUD.set_vanity_slug(conn, entry_id, "fresh-vanity")
    assert ok is True

    refreshed = await EntryCRUD.get_by_id(conn, entry_id)
    assert refreshed is not None
    assert refreshed.slug == "fresh-vanity"

    # No alias should be recorded since there was no prior slug.
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
        "VALUES (?, ?, datetime('now'))",
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
    # Seed it with values, then clear with an empty list.
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


@pytest.mark.asyncio
async def test_search_public_id_filter_branches_with_full_query_payload(
    test_db: object,
) -> None:
    """Hit each filter branch in _search_public_ids (lines 956-987)."""
    from datetime import date

    conn = test_db
    # Create a parent organization so affiliated_org_id satisfies the FK.
    parent_org_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Parent Affiliate Org",
        description="Parent organization referenced via affiliated_org_id.",
        city="Kansas City",
        state="MO",
        geo_specificity="regional",
        region="Kansas City metro",
    )
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Comprehensive Filter Org",
        description="Entry that matches every public-search facet filter.",
        city="Kansas City",
        state="MO",
        geo_specificity="regional",
        region="Kansas City metro",
        affiliated_org_id=parent_org_id,
    )
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
        "VALUES (?, ?, datetime('now'))",
        (entry_id, "housing_affordability"),
    )
    await conn.commit()

    # Create a fresh source inside this test so we don't cross fixtures.
    source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/coverage-search-public",
        source_type="news_article",
        extraction_method="manual",
        title="Coverage source",
        publication="Test Publication",
        published_date=date(2026, 2, 1),
    )
    await SourceCRUD.link_to_entry(
        conn,
        entry_id,
        source_id,
        extraction_context="Used for facet filter coverage.",
    )

    result = await EntryCRUD.search_public(
        conn,
        query="Comprehensive",
        states=["MO"],
        cities=["Kansas City"],
        regions=["Kansas City metro"],
        issue_areas=["housing_affordability"],
        entry_types=["organization"],
        source_types=["news_article"],
        affiliated_org_id=parent_org_id,
    )

    assert result["total"] >= 1
    assert any(item["entry"].id == entry_id for item in result["entries"])


@pytest.mark.asyncio
async def test_load_entries_with_metrics_returns_empty_for_empty_ids(test_db: object) -> None:
    """_load_entries_with_metrics should short-circuit on empty input (line 1001)."""
    rows = await EntryCRUD._load_entries_with_metrics(test_db, [], limit=10, offset=0)  # noqa: SLF001
    assert rows == []


@pytest.mark.asyncio
async def test_load_entries_with_metrics_returns_empty_when_offset_overshoots(
    test_db: object, sample_entry: object
) -> None:
    """_load_entries_with_metrics should return [] when no rows match the page (line 1022)."""
    rows = await EntryCRUD._load_entries_with_metrics(  # noqa: SLF001
        test_db, [sample_entry], limit=1, offset=100
    )
    assert rows == []


@pytest.mark.asyncio
async def test_build_facets_returns_empty_payload_for_empty_ids(test_db: object) -> None:
    """_build_facets should return the empty facet payload on empty input (line 1043)."""
    result = await EntryCRUD._build_facets(test_db, [])  # noqa: SLF001
    assert result == {
        "states": [],
        "cities": [],
        "regions": [],
        "issue_areas": [],
        "entity_types": [],
        "source_types": [],
    }


def test_row_to_entry_ignores_non_list_suppressed_payload() -> None:
    """_row_to_entry should not coerce non-list decoded payloads into the field (1132->1134)."""
    row = {
        "id": "entry-1",
        "type": "person",
        "name": "Decode Test",
        "description": "Row builder coverage.",
        "city": None,
        "state": None,
        "region": None,
        "geo_specificity": "local",
        "full_address": None,
        "website": None,
        "email": None,
        "phone": None,
        "social_media": None,
        "affiliated_org_id": None,
        "active": 1,
        "verified": 0,
        "last_verified": None,
        "contact_status": "not_contacted",
        "editorial_notes": None,
        "priority": None,
        "first_seen": "2026-01-01",
        "last_seen": "2026-01-02",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-02T00:00:00Z",
        "slug": "decode-test-aaaa",
        "photo_url": None,
        "custom_bio": None,
        "claim_status": "unclaimed",
        "claimed_by_user_id": None,
        "claim_verified_at": None,
        "last_confirmed_at": None,
        # JSON-encoded *non-list* (an object) — decoded value is dict, not list.
        "suppressed_source_ids": '{"not": "a list"}',
        "preferred_contact_channel": None,
    }

    entry = _row_to_entry(row)
    assert entry.suppressed_source_ids == []


def test_entry_crud_export_alias_matches_definition() -> None:
    """The re-exported EntryCRUD reference should match the canonical implementation."""
    assert EntryCRUDExport is EntryCRUD


@pytest.mark.asyncio
async def test_create_persists_inactive_entry_and_hides_it_from_public_search(
    test_db: object,
) -> None:
    """An entry created with active=False is inactive and absent from public results."""
    active_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Visible Org",
        description="A published organization.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    held_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Held Org",
        description="An organization held for review.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        active=False,
    )

    held_entry = await EntryCRUD.get_by_id(test_db, held_id)
    active_entry = await EntryCRUD.get_by_id(test_db, active_id)
    public_ids = await EntryCRUD._search_public_ids(test_db, states=["MO"])  # noqa: SLF001

    assert held_entry is not None
    assert held_entry.active is False
    assert active_entry is not None
    assert active_entry.active is True
    assert held_id not in public_ids
    assert active_id in public_ids


class _StubCursor:
    """Minimal cursor stub that records the SQL executed and returns no rows."""

    def __init__(self, executed: list[tuple[str, object]]) -> None:
        self._executed = executed
        self.description: list[tuple[str, ...]] = []

    async def fetchall(self) -> list[tuple[object, ...]]:
        return []

    async def fetchone(self) -> tuple[object, ...] | None:
        return None


class _PostgresLikeConnection:
    """Connection stub that advertises ``backend = "postgres"`` for branch coverage."""

    backend = "postgres"

    def __init__(self) -> None:
        self.executed: list[tuple[str, object]] = []

    async def execute(self, sql: str, parameters: object = ()) -> _StubCursor:
        self.executed.append((sql, parameters))
        return _StubCursor(self.executed)

    async def commit(self) -> None:
        return None


@pytest.mark.asyncio
async def test_search_fts_postgres_branch_emits_tsquery_sql() -> None:
    """search_fts should emit Postgres tsquery SQL when backend == 'postgres' (line 484)."""
    conn = _PostgresLikeConnection()
    rows = await EntryCRUD.search_fts(conn, "anything")
    assert rows == []
    assert any("plainto_tsquery" in sql for sql, _ in conn.executed)


@pytest.mark.asyncio
async def test_search_public_ids_postgres_branch_emits_tsquery_sql() -> None:
    """_search_public_ids should emit Postgres tsquery SQL when backend == 'postgres' (line 957)."""
    conn = _PostgresLikeConnection()
    ids = await EntryCRUD._search_public_ids(conn, query="anything")  # noqa: SLF001
    assert ids == []
    assert any("plainto_tsquery" in sql for sql, _ in conn.executed)
