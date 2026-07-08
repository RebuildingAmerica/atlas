"""GET /api/entities/map exposes the viewport projection over HTTP."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from .support import _KC_LAT, _KC_LNG, _THREE, _TWO, _link_issue, _link_source, _place

if TYPE_CHECKING:
    import aiosqlite

pytestmark = pytest.mark.asyncio

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
