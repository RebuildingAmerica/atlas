"""Only entries inside the requested viewport are returned."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD

from .support import _KC_LAT, _KC_LNG, _US_BBOX, _place

if TYPE_CHECKING:
    import aiosqlite

pytestmark = pytest.mark.asyncio


class TestBoundingBox:
    """Only entries inside the requested viewport are returned."""

    async def test_includes_points_inside_bbox(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Inside KC")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert [point["id"] for point in result["points"]] == [entry_id]
        assert result["total"] == 1
        assert result["capped"] is False

    async def test_excludes_points_outside_bbox(self, test_db: aiosqlite.Connection) -> None:
        await _place(test_db, name="Inside KC", latitude=_KC_LAT, longitude=_KC_LNG)
        await _place(
            test_db,
            name="Honolulu",
            city="Honolulu",
            state="HI",
            latitude=21.3,
            longitude=-157.8,
        )

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        names = {point["name"] for point in result["points"]}
        assert names == {"Inside KC"}

    async def test_excludes_null_coordinate_rows(self, test_db: aiosqlite.Connection) -> None:
        await _place(test_db, name="Placed", latitude=_KC_LAT, longitude=_KC_LNG)
        await _place(test_db, name="Unplaced", latitude=None, longitude=None)

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        names = {point["name"] for point in result["points"]}
        assert names == {"Placed"}
