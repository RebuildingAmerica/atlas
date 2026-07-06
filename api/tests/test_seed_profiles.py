"""Tests for launch seed profile data."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.models import get_db_connection
from atlas.seed_profiles import SEED_ENTRIES, seed_profiles


@pytest.mark.asyncio
async def test_seeded_profiles_are_visible_on_the_public_map(db_url: str) -> None:
    await seed_profiles(db_url)

    conn = await get_db_connection(db_url)
    try:
        result = await EntryCRUD.search_map_points(
            conn,
            min_lng=-125.0,
            min_lat=24.0,
            max_lng=-66.0,
            max_lat=50.0,
            limit=2000,
        )
    finally:
        await conn.close()

    assert result["total"] == len(SEED_ENTRIES)
    names = {point["name"] for point in result["points"]}
    assert "Eastside Housing Network" in names
    assert "Maya Thompson" in names
