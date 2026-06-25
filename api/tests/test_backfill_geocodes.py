"""Tests for the idempotent geocode backfill script."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas import backfill_geocodes
from atlas.domains.catalog.geo.geocoder import GeocodeResult
from atlas.models import EntryCRUD, get_db_connection

if TYPE_CHECKING:
    import aiosqlite

# Kansas City, MO city centroid from the bundled gazetteer.
_KC_LAT = 39.1
_KC_LNG = -94.58


async def _make_entry(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    name: str,
    city: str | None,
    state: str | None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> str:
    return await EntryCRUD.create(
        conn,
        entry_type="organization",
        name=name,
        description="A civic actor.",
        city=city,
        state=state,
        geo_specificity="local",
        latitude=latitude,
        longitude=longitude,
    )


@pytest.mark.asyncio
class TestBackfill:
    """The backfill places every locatable, unplaced actor."""

    async def test_geocodes_unplaced_entries_offline(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            entry_id = await _make_entry(conn, name="KC Org", city="Kansas City", state="MO")
        finally:
            await conn.close()

        placed = await backfill_geocodes.backfill_geocodes(db_url)

        assert placed == 1
        conn = await get_db_connection(db_url)
        try:
            stored = await EntryCRUD.get_by_id(conn, entry_id)
        finally:
            await conn.close()
        assert stored is not None
        assert stored.latitude == _KC_LAT
        assert stored.longitude == _KC_LNG
        assert stored.geocode_precision == "city"
        assert stored.geocode_source == "gazetteer"

    async def test_skips_already_placed_entries(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            await _make_entry(
                conn,
                name="Placed Org",
                city="Kansas City",
                state="MO",
                latitude=12.0,
                longitude=34.0,
            )
        finally:
            await conn.close()

        placed = await backfill_geocodes.backfill_geocodes(db_url)

        assert placed == 0

    async def test_skips_entries_without_state(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            entry_id = await _make_entry(conn, name="Stateless Org", city="Somewhere", state=None)
        finally:
            await conn.close()

        placed = await backfill_geocodes.backfill_geocodes(db_url)

        assert placed == 0
        conn = await get_db_connection(db_url)
        try:
            stored = await EntryCRUD.get_by_id(conn, entry_id)
        finally:
            await conn.close()
        assert stored is not None
        assert stored.latitude is None

    async def test_unresolvable_entry_is_left_unplaced(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            await _make_entry(conn, name="Nowhere Org", city="Nowhere", state="ZZ")
        finally:
            await conn.close()

        placed = await backfill_geocodes.backfill_geocodes(db_url)

        assert placed == 0

    async def test_is_idempotent_across_runs(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            await _make_entry(conn, name="KC Org", city="Kansas City", state="MO")
        finally:
            await conn.close()

        first = await backfill_geocodes.backfill_geocodes(db_url)
        second = await backfill_geocodes.backfill_geocodes(db_url)

        assert first == 1
        assert second == 0

    async def test_use_census_allows_remote_rooftop(
        self, db_url: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        conn = await get_db_connection(db_url)
        try:
            entry_id = await _make_entry(conn, name="Rooftop Org", city="Kansas City", state="MO")
        finally:
            await conn.close()

        calls: list[bool] = []

        async def fake_geocode(
            city: str | None,
            state: str | None,
            full_address: str | None,
            *,
            allow_remote: bool = False,
        ) -> GeocodeResult:
            del city, state, full_address
            calls.append(allow_remote)
            return GeocodeResult(
                latitude=39.07, longitude=-94.59, precision="rooftop", source="census"
            )

        monkeypatch.setattr(backfill_geocodes, "geocode_entry", fake_geocode)

        placed = await backfill_geocodes.backfill_geocodes(db_url, use_census=True)

        assert placed == 1
        assert calls == [True]
        conn = await get_db_connection(db_url)
        try:
            stored = await EntryCRUD.get_by_id(conn, entry_id)
        finally:
            await conn.close()
        assert stored is not None
        assert stored.geocode_precision == "rooftop"
        assert stored.geocode_source == "census"


class TestEntrypoint:
    """The CLI wiring resolves arguments and runs the backfill."""

    def test_parse_args_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("sys.argv", ["backfill_geocodes"])

        args = backfill_geocodes._parse_args()  # noqa: SLF001

        assert args.database_url == "sqlite:///atlas.db"
        assert args.use_census is False

    def test_parse_args_accepts_flags(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "sys.argv",
            ["backfill_geocodes", "--database-url", "sqlite:///other.db", "--use-census"],
        )

        args = backfill_geocodes._parse_args()  # noqa: SLF001

        assert args.database_url == "sqlite:///other.db"
        assert args.use_census is True

    def test_main_runs_backfill(self, monkeypatch: pytest.MonkeyPatch, db_url: str) -> None:
        recorded: dict[str, object] = {}

        async def fake_backfill(database_url: str, *, use_census: bool = False) -> int:
            recorded["database_url"] = database_url
            recorded["use_census"] = use_census
            return 0

        monkeypatch.setattr(backfill_geocodes, "backfill_geocodes", fake_backfill)
        monkeypatch.setattr("sys.argv", ["backfill_geocodes", "--database-url", db_url])

        backfill_geocodes.main()

        assert recorded["database_url"] == db_url
        assert recorded["use_census"] is False
