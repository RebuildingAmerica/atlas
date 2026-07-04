"""Tests for the viewport map-point projection used by the Atlas map."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.models import SourceCRUD

if TYPE_CHECKING:
    import aiosqlite

# A continental-US bounding box that contains every seeded test point.
_US_BBOX = {
    "min_lng": -125.0,
    "min_lat": 24.0,
    "max_lng": -66.0,
    "max_lat": 50.0,
}

# Kansas City, MO city centroid from the bundled gazetteer.
_KC_LAT = 39.1
_KC_LNG = -94.58

_TWO = 2
_THREE = 3


async def _place(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    name: str,
    entry_type: str = "organization",
    city: str = "Kansas City",
    state: str = "MO",
    latitude: float | None = _KC_LAT,
    longitude: float | None = _KC_LNG,
    verified: bool = False,
    active: bool = True,
) -> str:
    """Create an entry placed (or not) on the map."""
    entry_id = await EntryCRUD.create(
        conn,
        entry_type=entry_type,
        name=name,
        description="A civic actor.",
        city=city,
        state=state,
        geo_specificity="local",
        latitude=latitude,
        longitude=longitude,
        geocode_precision="city" if latitude is not None else None,
        geocode_source="gazetteer" if latitude is not None else None,
        active=active,
    )
    if verified:
        await EntryCRUD.update(conn, entry_id, verified=True)
    return entry_id


async def _link_issue(conn: aiosqlite.Connection, entry_id: str, issue_area: str) -> None:
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
        (entry_id, issue_area, "2026-01-01T00:00:00"),
    )
    await conn.commit()


async def _link_source(conn: aiosqlite.Connection, entry_id: str, url: str) -> None:
    source_id = await SourceCRUD.create(
        conn,
        url=url,
        source_type="news_article",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(conn, entry_id, source_id, "context")


class TestBoundingBox:
    """Only entries inside the requested viewport are returned."""

    async def test_includes_points_inside_bbox(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Inside KC")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert [point["id"] for point in result["points"]] == [entry_id]
        assert result["total"] == 1
        assert result["capped"] is False

    async def test_excludes_points_outside_bbox(self, test_db: aiosqlite.Connection) -> None:
        await _place(test_db, name="Inside KC", latitude=39.1, longitude=-94.58)
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
        await _place(test_db, name="Placed", latitude=39.1, longitude=-94.58)
        await _place(test_db, name="Unplaced", latitude=None, longitude=None)

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        names = {point["name"] for point in result["points"]}
        assert names == {"Placed"}


class TestProjectionShape:
    """The projection carries exactly the fields the map renders."""

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


class TestTrustLevel:
    """trust_level mirrors the canonical app-wide trust tiers."""

    async def test_verified_entry_is_atlas_verified(self, test_db: aiosqlite.Connection) -> None:
        await _place(test_db, name="Verified Org", verified=True)

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"][0]["trust_level"] == "atlas_verified"

    async def test_two_source_domains_are_corroborated(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Corroborated Org")
        await _link_source(test_db, entry_id, "https://one.example.com/a")
        await _link_source(test_db, entry_id, "https://two.example.org/b")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"][0]["trust_level"] == "corroborated"

    async def test_single_source_domain_is_unverified(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Thin Org")
        await _link_source(test_db, entry_id, "https://one.example.com/a")
        await _link_source(test_db, entry_id, "https://one.example.com/b")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"][0]["trust_level"] == "unverified"


class TestFilterParity:
    """Map filters reuse the exact browse facet vocabulary."""

    async def test_issue_area_filter_narrows_points(self, test_db: aiosqlite.Connection) -> None:
        housing = await _place(test_db, name="Housing Org")
        await _link_issue(test_db, housing, "housing_affordability")
        transit = await _place(test_db, name="Transit Org")
        await _link_issue(test_db, transit, "public_transit")

        result = await EntryCRUD.search_map_points(
            test_db, **_US_BBOX, issue_areas=["housing_affordability"], limit=2000
        )

        assert [point["id"] for point in result["points"]] == [housing]

    async def test_state_filter_narrows_points(self, test_db: aiosqlite.Connection) -> None:
        mo = await _place(test_db, name="MO Org", state="MO")
        await _place(test_db, name="KS Org", city="Topeka", state="KS", longitude=-95.69)

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, states=["MO"], limit=2000)

        assert [point["id"] for point in result["points"]] == [mo]

    async def test_source_pattern_filter_narrows_points(
        self, test_db: aiosqlite.Connection
    ) -> None:
        multi_source = await _place(test_db, name="Multi Source Org")
        await _link_source(test_db, multi_source, "https://one.example.com/a")
        await _link_source(test_db, multi_source, "https://two.example.org/b")
        single_source = await _place(test_db, name="Single Source Org")
        await _link_source(test_db, single_source, "https://one.example.com/c")

        result = await EntryCRUD.search_map_points(
            test_db, **_US_BBOX, source_patterns=["multi_source"], limit=2000
        )

        assert [point["id"] for point in result["points"]] == [multi_source]

    async def test_inactive_entries_excluded(self, test_db: aiosqlite.Connection) -> None:
        await _place(test_db, name="Hidden Org", active=False)

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"] == []
        assert result["total"] == 0


class TestCap:
    """The limit caps the payload and reports when the viewport overflows."""

    async def test_capped_true_when_total_exceeds_limit(
        self, test_db: aiosqlite.Connection
    ) -> None:
        for index in range(_THREE):
            await _place(test_db, name=f"Org {index}")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=_TWO)

        assert len(result["points"]) == _TWO
        assert result["total"] == _THREE
        assert result["capped"] is True

    async def test_capped_false_when_within_limit(self, test_db: aiosqlite.Connection) -> None:
        for index in range(_TWO):
            await _place(test_db, name=f"Org {index}")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=_TWO)

        assert len(result["points"]) == _TWO
        assert result["total"] == _TWO
        assert result["capped"] is False


_OK = 200
_BAD_REQUEST = 400


class TestMapEndpoint:
    """GET /api/entities/map exposes the viewport projection over HTTP."""

    async def test_returns_points_in_viewport(
        self, test_client: object, test_db: aiosqlite.Connection
    ) -> None:
        entry_id = await _place(test_db, name="Endpoint Org")
        await _link_issue(test_db, entry_id, "housing_affordability")

        response = await test_client.get(
            "/api/entities/map?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50"
        )

        assert response.status_code == _OK
        data = response.json()
        assert data["total"] == 1
        assert data["capped"] is False
        point = data["points"][0]
        assert point["id"] == entry_id
        assert point["lat"] == _KC_LAT
        assert point["lng"] == _KC_LNG
        assert point["issue_areas"] == ["housing_affordability"]
        assert point["trust_level"] == "unverified"

    async def test_filters_by_issue_area(
        self, test_client: object, test_db: aiosqlite.Connection
    ) -> None:
        housing = await _place(test_db, name="Housing Org")
        await _link_issue(test_db, housing, "housing_affordability")
        transit = await _place(test_db, name="Transit Org")
        await _link_issue(test_db, transit, "public_transit")

        response = await test_client.get(
            "/api/entities/map"
            "?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50"
            "&issue_area=housing_affordability"
        )

        assert response.status_code == _OK
        data = response.json()
        assert [point["id"] for point in data["points"]] == [housing]

    async def test_filters_by_source_pattern(
        self, test_client: object, test_db: aiosqlite.Connection
    ) -> None:
        multi_source = await _place(test_db, name="Multi Source Endpoint Org")
        await _link_source(test_db, multi_source, "https://one.example.com/a")
        await _link_source(test_db, multi_source, "https://two.example.org/b")
        single_source = await _place(test_db, name="Single Source Endpoint Org")
        await _link_source(test_db, single_source, "https://one.example.com/c")

        response = await test_client.get(
            "/api/entities/map"
            "?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50"
            "&source_pattern=multi_source"
        )

        assert response.status_code == _OK
        data = response.json()
        assert [point["id"] for point in data["points"]] == [multi_source]

    async def test_rejects_invalid_issue_area(self, test_client: object) -> None:
        response = await test_client.get(
            "/api/entities/map"
            "?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50"
            "&issue_area=not_a_real_issue"
        )

        assert response.status_code == _BAD_REQUEST

    async def test_caps_payload_and_reports_capped(
        self, test_client: object, test_db: aiosqlite.Connection
    ) -> None:
        for index in range(_THREE):
            await _place(test_db, name=f"Capped Org {index}")

        response = await test_client.get(
            "/api/entities/map?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50&limit=2"
        )

        assert response.status_code == _OK
        data = response.json()
        assert len(data["points"]) == _TWO
        assert data["total"] == _THREE
        assert data["capped"] is True


pytestmark = pytest.mark.asyncio
