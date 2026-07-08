"""Shared helpers for the catalog map-point test suite."""

from __future__ import annotations

import datetime  # noqa: TC003
from typing import TYPE_CHECKING

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


async def _link_source(
    conn: aiosqlite.Connection,
    entry_id: str,
    url: str,
    *,
    published_date: datetime.date | None = None,
) -> str:
    source_id = await SourceCRUD.create(
        conn,
        url=url,
        source_type="news_article",
        extraction_method="manual",
        published_date=published_date,
    )
    await SourceCRUD.link_to_entry(conn, entry_id, source_id, "context")
    return source_id
