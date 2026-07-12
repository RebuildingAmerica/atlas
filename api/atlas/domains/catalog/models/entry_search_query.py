"""Entry search mixin and public-facing projection methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry_model import _map_trust_level, actor_quality

from .entry_search_backend import build_facets, load_entries_with_metrics, search_public_ids
from .entry_search_helpers import (
    _empty_facets,
    _latest_source_date,
    _make_placeholders,
    _place_label,
    _public_map_sources,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    import aiosqlite


class EntrySearchMixin:
    """Search and map read operations mixed into EntryCRUD."""

    @staticmethod
    async def get_issue_areas_for_entries(
        conn: aiosqlite.Connection,
        entry_ids: list[str],
    ) -> dict[str, list[str]]:
        """Get issue-area slugs for multiple entries."""
        if not entry_ids:
            return {}

        placeholders = _make_placeholders(entry_ids)
        cursor = await conn.execute(
            f"""
            SELECT entry_id, issue_area
            FROM entry_issue_areas
            WHERE entry_id IN ({placeholders})
            ORDER BY issue_area ASC
            """,
            entry_ids,
        )
        rows = await cursor.fetchall()
        result: dict[str, list[str]] = {entry_id: [] for entry_id in entry_ids}
        for entry_id, issue_area in rows:
            result.setdefault(entry_id, []).append(issue_area)
        return result

    @staticmethod
    async def get_sources_for_entries(
        conn: aiosqlite.Connection,
        entry_ids: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        """Get linked sources for multiple entries."""
        if not entry_ids:
            return {}

        placeholders = _make_placeholders(entry_ids)
        cursor = await conn.execute(
            f"""
            SELECT
                es.entry_id,
                s.id,
                s.url,
                s.title,
                s.publication,
                s.published_date,
                s.type,
                s.ingested_at,
                s.extraction_method,
                s.created_at,
                es.extraction_context
            FROM entry_sources es
            JOIN sources s ON s.id = es.source_id
            WHERE es.entry_id IN ({placeholders})
            ORDER BY COALESCE(s.published_date, DATE(s.ingested_at)) DESC, s.ingested_at DESC
            """,
            entry_ids,
        )
        rows = await cursor.fetchall()
        result: dict[str, list[dict[str, Any]]] = {entry_id: [] for entry_id in entry_ids}
        for row in rows:
            result.setdefault(row[0], []).append(
                {
                    "id": row[1],
                    "url": row[2],
                    "title": row[3],
                    "publication": row[4],
                    "published_date": row[5],
                    "type": row[6],
                    "ingested_at": row[7],
                    "extraction_method": row[8],
                    "created_at": row[9],
                    "extraction_context": row[10],
                }
            )
        return result

    @staticmethod
    async def search_public(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        query: str | None = None,
        states: list[str] | None = None,
        cities: list[str] | None = None,
        regions: list[str] | None = None,
        place_filters: Sequence[Mapping[str, str | None]] | None = None,
        issue_areas: list[str] | None = None,
        entry_types: list[str] | None = None,
        source_types: list[str] | None = None,
        source_patterns: list[str] | None = None,
        affiliated_org_id: str | None = None,
        sort: str = "relevance",
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Search public-facing entry results with multi-dimensional filters."""
        matched_ids = await search_public_ids(
            conn,
            query=query,
            states=states,
            cities=cities,
            regions=regions,
            place_filters=place_filters,
            issue_areas=issue_areas,
            entry_types=entry_types,
            source_types=source_types,
            source_patterns=source_patterns,
            affiliated_org_id=affiliated_org_id,
        )

        if not matched_ids:
            return {
                "entries": [],
                "total": 0,
                "facets": _empty_facets(),
            }

        paged_records = await load_entries_with_metrics(
            conn,
            entry_ids=matched_ids,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        page_entry_ids = [record["entry"].id for record in paged_records]
        issue_map = await EntrySearchMixin.get_issue_areas_for_entries(conn, page_entry_ids)
        source_map = await EntrySearchMixin.get_sources_for_entries(conn, page_entry_ids)
        facets = await build_facets(conn, matched_ids)

        entries = []
        for record in paged_records:
            entry = record["entry"]
            sources = source_map.get(entry.id, [])
            entry_issue_areas = issue_map.get(entry.id, [])
            entries.append(
                {
                    "entry": entry,
                    "issue_areas": entry_issue_areas,
                    "source_types": sorted({source["type"] for source in sources}),
                    "source_count": record["source_count"],
                    "latest_source_date": record["latest_source_date"],
                    "actor_quality": actor_quality(
                        entry,
                        issue_area_ids=entry_issue_areas,
                        source_count=record["source_count"],
                    ),
                }
            )

        return {
            "entries": entries,
            "total": len(matched_ids),
            "facets": facets,
        }

    @staticmethod
    async def search_map_points(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        query: str | None = None,
        states: list[str] | None = None,
        cities: list[str] | None = None,
        regions: list[str] | None = None,
        place_filters: Sequence[Mapping[str, str | None]] | None = None,
        issue_areas: list[str] | None = None,
        entry_types: list[str] | None = None,
        source_types: list[str] | None = None,
        source_patterns: list[str] | None = None,
        limit: int = 2000,
    ) -> dict[str, Any]:
        """Resolve a viewport's placed actors into a tiny map projection."""
        matched_ids = await search_public_ids(
            conn,
            query=query,
            states=states,
            cities=cities,
            regions=regions,
            place_filters=place_filters,
            issue_areas=issue_areas,
            entry_types=entry_types,
            source_types=source_types,
            source_patterns=source_patterns,
        )
        if not matched_ids:
            return {"points": [], "total": 0, "capped": False}

        placeholders = _make_placeholders(matched_ids)
        cursor = await conn.execute(
            f"""
            SELECT
                id,
                name,
                type,
                slug,
                city,
                state,
                region,
                geo_specificity,
                latitude,
                longitude,
                geocode_precision,
                geocode_source,
                suppressed_source_ids,
                verified,
                claim_status
            FROM entries
            WHERE id IN ({placeholders})
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND latitude BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
            ORDER BY verified DESC, name ASC
            """,
            [*matched_ids, min_lat, max_lat, min_lng, max_lng],
        )
        rows = await cursor.fetchall()
        columns = [col[0] for col in cursor.description]
        placed = [dict(zip(columns, row, strict=False)) for row in rows]

        total = len(placed)
        capped = total > limit
        visible = placed[:limit]
        visible_ids = [row["id"] for row in visible]
        issue_map = await EntrySearchMixin.get_issue_areas_for_entries(conn, visible_ids)
        source_map = await EntrySearchMixin.get_sources_for_entries(conn, visible_ids)

        points = []
        for row in visible:
            sources = _public_map_sources(row, source_map.get(row["id"], []))
            points.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["type"],
                    "slug": row["slug"],
                    "place_label": _place_label(row),
                    "geo_specificity": row.get("geo_specificity"),
                    "geocode_precision": row.get("geocode_precision"),
                    "geocode_source": row.get("geocode_source"),
                    "lat": float(row["latitude"]),
                    "lng": float(row["longitude"]),
                    "issue_areas": issue_map.get(row["id"], []),
                    "source_count": len(sources),
                    "latest_source_date": _latest_source_date(sources),
                    "trust_level": _map_trust_level(
                        verified=bool(row["verified"]),
                        claim_status=row.get("claim_status"),
                        sources=sources,
                    ),
                }
            )
        return {"points": points, "total": total, "capped": capped}

    @staticmethod
    async def _search_public_ids(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        query: str | None = None,
        states: list[str] | None = None,
        cities: list[str] | None = None,
        regions: list[str] | None = None,
        place_filters: Sequence[Mapping[str, str | None]] | None = None,
        issue_areas: list[str] | None = None,
        entry_types: list[str] | None = None,
        source_types: list[str] | None = None,
        source_patterns: list[str] | None = None,
        affiliated_org_id: str | None = None,
    ) -> list[str]:
        """Compatibility wrapper for the public-search ID filter."""
        return await search_public_ids(
            conn,
            query=query,
            states=states,
            cities=cities,
            regions=regions,
            place_filters=place_filters,
            issue_areas=issue_areas,
            entry_types=entry_types,
            source_types=source_types,
            source_patterns=source_patterns,
            affiliated_org_id=affiliated_org_id,
        )

    @staticmethod
    async def _load_entries_with_metrics(
        conn: aiosqlite.Connection,
        entry_ids: list[str],
        sort: str,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        """Compatibility wrapper for the metrics-hydrated entry loader."""
        return await load_entries_with_metrics(conn, entry_ids, sort, limit, offset)

    @staticmethod
    async def _build_facets(
        conn: aiosqlite.Connection,
        entry_ids: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        """Compatibility wrapper for the search facet builder."""
        return await build_facets(conn, entry_ids)
