"""Geocode and row-helper coverage for atlas.domains.catalog.models.entry."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD, _row_to_entry
from atlas.models import EntryCRUD as EntryCRUDExport


@pytest.mark.asyncio
async def test_create_persists_geocode_fields_and_round_trips(test_db: object) -> None:
    """create() should persist latitude/longitude/precision/source and read them back."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Geocoded Org",
        description="An organization placed on the map.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        latitude=39.1,
        longitude=-94.58,
        geocode_precision="city",
        geocode_source="gazetteer",
    )

    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None
    assert entry.latitude == pytest.approx(39.1)
    assert entry.longitude == pytest.approx(-94.58)
    assert entry.geocode_precision == "city"
    assert entry.geocode_source == "gazetteer"


@pytest.mark.asyncio
async def test_create_defaults_geocode_fields_to_none(test_db: object) -> None:
    """create() should leave coordinates NULL when no location is resolved."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Unplaced Person",
        description="A person with no known location.",
        city=None,
        state=None,
        geo_specificity="national",
    )

    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None
    assert entry.latitude is None
    assert entry.longitude is None
    assert entry.geocode_precision is None
    assert entry.geocode_source is None


@pytest.mark.asyncio
async def test_update_sets_geocode_fields(test_db: object) -> None:
    """update() should accept the geocode fields as allowed updates."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Backfill Target",
        description="An organization awaiting a geocode backfill.",
        city="Austin",
        state="TX",
        geo_specificity="local",
    )

    ok = await EntryCRUD.update(
        conn,
        entry_id,
        latitude=30.27,
        longitude=-97.74,
        geocode_precision="rooftop",
        geocode_source="census",
    )
    assert ok is True

    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None
    assert entry.latitude == pytest.approx(30.27)
    assert entry.longitude == pytest.approx(-97.74)
    assert entry.geocode_precision == "rooftop"
    assert entry.geocode_source == "census"


@pytest.mark.asyncio
async def test_to_dict_includes_geocode_fields(test_db: object) -> None:
    """to_dict() should surface the geocode fields for downstream consumers."""
    conn = test_db
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Dict Org",
        description="An organization serialized to a dict.",
        city="Denver",
        state="CO",
        geo_specificity="local",
        latitude=39.74,
        longitude=-104.98,
        geocode_precision="city",
        geocode_source="gazetteer",
    )
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None

    payload = entry.to_dict()
    assert payload["latitude"] == pytest.approx(39.74)
    assert payload["longitude"] == pytest.approx(-104.98)
    assert payload["geocode_precision"] == "city"
    assert payload["geocode_source"] == "gazetteer"


def test_row_to_entry_coerces_integer_coordinates_to_float() -> None:
    """_row_to_entry should coerce non-null coordinates to float (and keep None as None)."""
    base = {
        "id": "geo-entry",
        "type": "organization",
        "name": "Coord Coerce",
        "description": "Row builder coordinate coercion.",
        "city": "Topeka",
        "state": "KS",
        "region": None,
        "geo_specificity": "local",
        "latitude": 39,
        "longitude": -95,
        "geocode_precision": "city",
        "geocode_source": "gazetteer",
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
        "slug": "coord-coerce-aaaa",
        "photo_url": None,
        "custom_bio": None,
        "claim_status": "unclaimed",
        "claimed_by_user_id": None,
        "claim_verified_at": None,
        "last_confirmed_at": None,
        "suppressed_source_ids": None,
        "preferred_contact_channel": None,
    }

    entry = _row_to_entry(base)
    assert isinstance(entry.latitude, float)
    assert entry.latitude == pytest.approx(39.0)
    assert isinstance(entry.longitude, float)
    assert entry.longitude == pytest.approx(-95.0)

    missing = {**base, "latitude": None, "longitude": None}
    unplaced = _row_to_entry(missing)
    assert unplaced.latitude is None
    assert unplaced.longitude is None


def test_row_to_entry_accepts_postgres_date_values() -> None:
    """Postgres returns DATE columns as date objects instead of SQLite-style strings."""
    row = {
        "id": "postgres-date-entry",
        "type": "organization",
        "name": "Postgres Date Org",
        "description": "Row builder date coercion.",
        "city": "Las Vegas",
        "state": "NV",
        "region": None,
        "geo_specificity": "local",
        "latitude": None,
        "longitude": None,
        "geocode_precision": None,
        "geocode_source": None,
        "full_address": None,
        "website": None,
        "email": None,
        "phone": None,
        "social_media": None,
        "affiliated_org_id": None,
        "active": False,
        "verified": False,
        "last_verified": datetime(2026, 1, 3, 14, 30, tzinfo=UTC),
        "contact_status": "not_contacted",
        "editorial_notes": None,
        "priority": None,
        "first_seen": date(2026, 1, 1),
        "last_seen": date(2026, 1, 2),
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-02T00:00:00Z",
        "slug": "postgres-date-org-aaaa",
        "photo_url": None,
        "custom_bio": None,
        "claim_status": "unclaimed",
        "claimed_by_user_id": None,
        "claim_verified_at": None,
        "last_confirmed_at": None,
        "suppressed_source_ids": None,
        "preferred_contact_channel": None,
    }

    entry = _row_to_entry(row)

    assert entry.last_verified == date(2026, 1, 3)
    assert entry.first_seen == date(2026, 1, 1)
    assert entry.last_seen == date(2026, 1, 2)


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
