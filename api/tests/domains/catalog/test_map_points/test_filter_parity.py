"""Map filters reuse the exact browse facet vocabulary."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD

from .support import _US_BBOX, _link_issue, _link_source, _place

if TYPE_CHECKING:
    import aiosqlite

pytestmark = pytest.mark.asyncio


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
