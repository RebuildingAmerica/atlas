"""The projection carries exactly the fields the map renders."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.schemas.public import MapPoint

from .support import _KC_LAT, _KC_LNG, _TWO, _US_BBOX, _link_issue, _link_source, _place

if TYPE_CHECKING:
    import aiosqlite

pytestmark = pytest.mark.asyncio


class TestProjectionShape:
    """The projection carries exactly the fields the map renders."""

    async def test_schema_requires_source_context_for_trust_rendering(self) -> None:
        schema = MapPoint.model_json_schema()

        assert "source_count" in schema["required"]
        assert schema["properties"]["source_count"]["minimum"] == 0
        assert schema["properties"]["geocode_precision"]["anyOf"][0]["enum"] == [
            "rooftop",
            "city",
            "state",
        ]
        assert schema["properties"]["geocode_source"]["anyOf"][0]["enum"] == [
            "census",
            "gazetteer",
            "manual",
        ]

    async def test_point_carries_tiny_projection(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Civic Org", entry_type="organization")
        await _link_issue(test_db, entry_id, "housing_affordability")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        point = result["points"][0]
        assert point["id"] == entry_id
        assert point["name"] == "Civic Org"
        assert point["type"] == "organization"
        assert point["slug"] is not None
        assert point["lat"] == _KC_LAT
        assert point["lng"] == _KC_LNG
        assert point["issue_areas"] == ["housing_affordability"]
        assert point["trust_level"] == "unverified"

    async def test_point_carries_place_precision_and_source_context(
        self, test_db: aiosqlite.Connection
    ) -> None:
        entry_id = await _place(test_db, name="Civic Org", entry_type="organization")
        await _link_source(
            test_db,
            entry_id,
            "https://one.example.com/a",
            published_date=_KC_LAT and __import__("datetime").date(2026, 5, 4),
        )
        await _link_source(
            test_db,
            entry_id,
            "https://two.example.org/b",
            published_date=__import__("datetime").date(2026, 4, 28),
        )

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        point = result["points"][0]
        assert point["place_label"] == "Kansas City, MO"
        assert point["geo_specificity"] == "local"
        assert point["geocode_precision"] == "city"
        assert point["geocode_source"] == "gazetteer"
        assert point["source_count"] == _TWO
        assert point["latest_source_date"] == "2026-05-04"
