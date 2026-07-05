"""Public search, facet, and map projection helpers for entries."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry_model import (
    _map_trust_level,
    _row_to_entry,
    actor_quality,
)
from atlas.platform.database import db

if TYPE_CHECKING:
    import builtins
    from collections.abc import Sequence

    import aiosqlite

__all__ = ["EntrySearchMixin", "_make_placeholders"]


class EntrySearchMixin:
    """Search and map read operations mixed into EntryCRUD."""

    @staticmethod
    async def get_issue_areas_for_entries(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
    ) -> dict[str, builtins.list[str]]:
        """
        Get issue-area slugs for multiple entries.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_ids : builtins.list[str]
            Entry IDs to load.

        Returns
        -------
        dict[str, builtins.list[str]]
            Entry ID to linked issue-area slugs.
        """
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
        result: dict[str, builtins.list[str]] = {entry_id: [] for entry_id in entry_ids}
        for entry_id, issue_area in rows:
            result.setdefault(entry_id, []).append(issue_area)
        return result

    @staticmethod
    async def get_sources_for_entries(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
    ) -> dict[str, builtins.list[dict[str, Any]]]:
        """
        Get linked sources for multiple entries.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_ids : list[str]
            Entry IDs to load.

        Returns
        -------
        dict[str, list[dict[str, Any]]]
            Entry ID to linked source dictionaries.
        """
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
            ORDER BY COALESCE(s.published_date, substr(s.ingested_at, 1, 10)) DESC, s.ingested_at DESC
            """,
            entry_ids,
        )
        rows = await cursor.fetchall()
        result: dict[str, builtins.list[dict[str, Any]]] = {entry_id: [] for entry_id in entry_ids}
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
        states: builtins.list[str] | None = None,
        cities: builtins.list[str] | None = None,
        regions: builtins.list[str] | None = None,
        issue_areas: builtins.list[str] | None = None,
        entry_types: builtins.list[str] | None = None,
        source_types: builtins.list[str] | None = None,
        source_patterns: builtins.list[str] | None = None,
        affiliated_org_id: str | None = None,
        sort: str = "relevance",
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Search public-facing entry results with multi-dimensional filters.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        query : str | None, optional
            Full-text query against name and description. Default is None.
        states : builtins.list[str] | None, optional
            State filters. Default is None.
        cities : builtins.list[str] | None, optional
            City filters. Default is None.
        regions : builtins.list[str] | None, optional
            Region filters. Default is None.
        issue_areas : builtins.list[str] | None, optional
            Issue-area filters. Default is None.
        entry_types : builtins.list[str] | None, optional
            Entry-type filters. Default is None.
        source_types : builtins.list[str] | None, optional
            Source-type filters. Default is None.
        source_patterns : builtins.list[str] | None, optional
            Source-pattern filters such as ``single_source`` or ``multi_source``. Default is None.
        sort : str, optional
            Sort order: relevance, source_count, recent, or name. Default is relevance.
        limit : int, optional
            Page size. Default is 20.
        offset : int, optional
            Page offset. Default is 0.

        Returns
        -------
        dict[str, Any]
            Search results, pagination metadata, and facet counts.
        """
        matched_ids = await EntrySearchMixin._search_public_ids(
            conn,
            query=query,
            states=states,
            cities=cities,
            regions=regions,
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

        paged_records = await EntrySearchMixin._load_entries_with_metrics(
            conn,
            entry_ids=matched_ids,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        page_entry_ids = [record["entry"].id for record in paged_records]
        issue_map = await EntrySearchMixin.get_issue_areas_for_entries(conn, page_entry_ids)
        source_map = await EntrySearchMixin.get_sources_for_entries(conn, page_entry_ids)
        facets = await EntrySearchMixin._build_facets(conn, matched_ids)

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
        states: builtins.list[str] | None = None,
        cities: builtins.list[str] | None = None,
        regions: builtins.list[str] | None = None,
        issue_areas: builtins.list[str] | None = None,
        entry_types: builtins.list[str] | None = None,
        source_types: builtins.list[str] | None = None,
        source_patterns: builtins.list[str] | None = None,
        limit: int = 2000,
    ) -> dict[str, Any]:
        """Resolve a viewport's placed actors into a tiny map projection.

        Reuses the exact browse facet filters via :meth:`_search_public_ids` so
        the map and the browse list can never diverge, then keeps only the rows
        that carry coordinates inside the requested bounding box. Each surviving
        actor is reduced to the fields the map renders for a dot, its place
        context, and the source-backed confidence cues available without a
        profile round trip.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        min_lng, min_lat, max_lng, max_lat : float
            The viewport bounding box. Only actors inside it are returned.
        query : str | None, optional
            Full-text query against name and description. Default is None.
        states, cities, regions : builtins.list[str] | None, optional
            Geographic filters. Default is None.
        issue_areas, entry_types, source_types : builtins.list[str] | None, optional
            Facet filters mirroring the browse vocabulary. Default is None.
        source_patterns : builtins.list[str] | None, optional
            Source-pattern filters such as ``single_source`` or ``multi_source``. Default is None.
        limit : int, optional
            Hard cap on returned points. Default is 2000.

        Returns
        -------
        dict[str, Any]
            ``points`` (the projection, capped at ``limit``), ``total`` (the true
            count inside the viewport before capping), and ``capped`` (whether the
            viewport overflowed the cap).
        """
        matched_ids = await EntrySearchMixin._search_public_ids(
            conn,
            query=query,
            states=states,
            cities=cities,
            regions=regions,
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
        states: builtins.list[str] | None = None,
        cities: builtins.list[str] | None = None,
        regions: builtins.list[str] | None = None,
        issue_areas: builtins.list[str] | None = None,
        entry_types: builtins.list[str] | None = None,
        source_types: builtins.list[str] | None = None,
        source_patterns: builtins.list[str] | None = None,
        affiliated_org_id: str | None = None,
    ) -> builtins.list[str]:
        query_sql = """
            SELECT DISTINCT e.id
            FROM entries e
            LEFT JOIN entry_issue_areas eia ON e.id = eia.entry_id
            LEFT JOIN entry_sources es ON e.id = es.entry_id
            LEFT JOIN sources s ON es.source_id = s.id
            WHERE e.active = TRUE
              AND NOT EXISTS (
                  SELECT 1
                  FROM resource_ownership ro
                  WHERE ro.resource_id = e.id
                    AND ro.resource_type = 'entry'
                    AND ro.visibility = 'private'
              )
        """
        params: builtins.list[Any] = []

        if query:
            if getattr(conn, "backend", None) == "postgres":
                query_sql += """
                    AND e.search_vector @@ plainto_tsquery('english', ?)
                """
            else:
                query_sql += """
                    AND e.rowid IN (
                        SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?
                    )
                """
            params.append(query)
        if states:
            query_sql += f" AND e.state IN ({_make_placeholders(states)})"
            params.extend(states)
        if cities:
            query_sql += f" AND e.city IN ({_make_placeholders(cities)})"
            params.extend(cities)
        if regions:
            query_sql += f" AND e.region IN ({_make_placeholders(regions)})"
            params.extend(regions)
        if issue_areas:
            query_sql += f" AND eia.issue_area IN ({_make_placeholders(issue_areas)})"
            params.extend(issue_areas)
        if entry_types:
            query_sql += f" AND e.type IN ({_make_placeholders(entry_types)})"
            params.extend(entry_types)
        if source_types:
            query_sql += f" AND s.type IN ({_make_placeholders(source_types)})"
            params.extend(source_types)
        if source_patterns:
            query_sql += f"""
                AND e.id IN (
                    SELECT es_patterns.entry_id
                    FROM entry_sources es_patterns
                    JOIN sources s_patterns ON s_patterns.id = es_patterns.source_id
                    GROUP BY es_patterns.entry_id
                    HAVING {_source_pattern_having_clause(source_patterns)}
                )
            """
        if affiliated_org_id:
            query_sql += " AND e.affiliated_org_id = ?"
            params.append(affiliated_org_id)

        cursor = await conn.execute(query_sql, params)
        rows = await cursor.fetchall()
        return [row[0] for row in rows]

    @staticmethod
    async def _load_entries_with_metrics(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
        sort: str,
        limit: int,
        offset: int,
    ) -> builtins.list[dict[str, Any]]:
        if not entry_ids:
            return []

        placeholders = _make_placeholders(entry_ids)
        order_clause = _entry_search_order_clause(sort)
        cursor = await conn.execute(
            f"""
            SELECT
                e.*,
                COUNT(DISTINCT eia.issue_area) AS issue_count,
                COUNT(DISTINCT es.source_id) AS source_count,
                MAX(COALESCE(s.published_date, substr(s.ingested_at, 1, 10), e.last_seen)) AS latest_source_date
            FROM entries e
            LEFT JOIN entry_issue_areas eia ON e.id = eia.entry_id
            LEFT JOIN entry_sources es ON e.id = es.entry_id
            LEFT JOIN sources s ON es.source_id = s.id
            WHERE e.id IN ({placeholders})
            GROUP BY e.id
            ORDER BY {order_clause}
            LIMIT ? OFFSET ?
            """,
            [*entry_ids, limit, offset],
        )
        rows = await cursor.fetchall()
        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        records = []
        for row in rows:
            data = dict(zip(columns, row, strict=False))
            records.append(
                {
                    "entry": _row_to_entry(data),
                    "source_count": int(data["source_count"] or 0),
                    "latest_source_date": data["latest_source_date"],
                }
            )
        return records

    @staticmethod
    async def _build_facets(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
    ) -> dict[str, builtins.list[dict[str, Any]]]:
        if not entry_ids:
            return _empty_facets()

        placeholders = _make_placeholders(entry_ids)
        params = entry_ids

        async def fetch_pairs(
            sql: str, query_params: builtins.list[Any]
        ) -> builtins.list[tuple[Any, Any]]:
            cursor = await conn.execute(sql, query_params)
            return await cursor.fetchall()  # type: ignore[return-value]

        state_rows = await fetch_pairs(
            f"""
            SELECT state, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders}) AND state IS NOT NULL
            GROUP BY state
            ORDER BY COUNT(*) DESC, state ASC
            """,
            params,
        )
        city_rows = await fetch_pairs(
            f"""
            SELECT city, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders}) AND city IS NOT NULL
            GROUP BY city
            ORDER BY COUNT(*) DESC, city ASC
            """,
            params,
        )
        region_rows = await fetch_pairs(
            f"""
            SELECT region, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders}) AND region IS NOT NULL
            GROUP BY region
            ORDER BY COUNT(*) DESC, region ASC
            """,
            params,
        )
        issue_rows = await fetch_pairs(
            f"""
            SELECT issue_area, COUNT(*)
            FROM entry_issue_areas
            WHERE entry_id IN ({placeholders})
            GROUP BY issue_area
            ORDER BY COUNT(*) DESC, issue_area ASC
            """,
            params,
        )
        type_rows = await fetch_pairs(
            f"""
            SELECT type, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders})
            GROUP BY type
            ORDER BY COUNT(*) DESC, type ASC
            """,
            params,
        )
        source_type_rows = await fetch_pairs(
            f"""
            SELECT s.type, COUNT(DISTINCT es.entry_id)
            FROM entry_sources es
            JOIN sources s ON s.id = es.source_id
            WHERE es.entry_id IN ({placeholders})
            GROUP BY s.type
            ORDER BY COUNT(DISTINCT es.entry_id) DESC, s.type ASC
            """,
            params,
        )
        source_pattern_rows = await fetch_pairs(
            f"""
            SELECT source_pattern, COUNT(*)
            FROM (
                SELECT
                    es.entry_id,
                    CASE
                        WHEN COUNT(DISTINCT es.source_id) = 1 THEN 'single_source'
                        WHEN COUNT(DISTINCT es.source_id) >= 2 THEN 'multi_source'
                    END AS source_pattern
                FROM entry_sources es
                WHERE es.entry_id IN ({placeholders})
                GROUP BY es.entry_id

                UNION ALL

                SELECT es.entry_id, 'social_only' AS source_pattern
                FROM entry_sources es
                JOIN sources s ON s.id = es.source_id
                WHERE es.entry_id IN ({placeholders})
                GROUP BY es.entry_id
                HAVING COUNT(DISTINCT es.source_id) > 0
                   AND SUM(CASE WHEN s.type <> 'social_media' THEN 1 ELSE 0 END) = 0
            )
            WHERE source_pattern IS NOT NULL
            GROUP BY source_pattern
            ORDER BY COUNT(*) DESC, source_pattern ASC
            """,
            [*params, *params],
        )

        return {
            "states": _facet_rows_to_dicts(state_rows),
            "cities": _facet_rows_to_dicts(city_rows),
            "regions": _facet_rows_to_dicts(region_rows),
            "issue_areas": _facet_rows_to_dicts(issue_rows),
            "entity_types": _facet_rows_to_dicts(type_rows),
            "source_types": _facet_rows_to_dicts(source_type_rows),
            "source_patterns": _facet_rows_to_dicts(source_pattern_rows),
        }


def _make_placeholders(values: Sequence[object]) -> str:
    """Create a comma-separated placeholder list for SQLite IN clauses."""
    return ", ".join(["?"] * len(values))


def _entry_search_order_clause(sort: str) -> str:
    """Return a safe static ORDER BY clause for public entity search."""
    clauses = {
        "relevance": """
            (
                CASE WHEN e.type IN ('person', 'organization') THEN 1 ELSE 0 END
                + CASE
                    WHEN TRIM(COALESCE(e.description, '')) <> ''
                      OR TRIM(COALESCE(e.custom_bio, '')) <> ''
                    THEN 1 ELSE 0
                  END
                + CASE
                    WHEN e.city IS NOT NULL
                      OR e.state IS NOT NULL
                      OR e.region IS NOT NULL
                      OR e.full_address IS NOT NULL
                      OR e.geo_specificity = 'local'
                    THEN 1 ELSE 0
                  END
                + CASE WHEN COUNT(DISTINCT eia.issue_area) > 0 THEN 1 ELSE 0 END
                + CASE WHEN COUNT(DISTINCT es.source_id) > 0 THEN 1 ELSE 0 END
            ) DESC,
            CASE
                WHEN e.type IN ('person', 'organization') THEN 0
                WHEN e.type = 'initiative' THEN 1
                ELSE 2
            END ASC,
            CASE
                WHEN e.website IS NOT NULL
                  OR e.email IS NOT NULL
                  OR e.phone IS NOT NULL
                  OR e.social_media IS NOT NULL
                THEN 1
                ELSE 0
            END DESC,
            source_count DESC,
            latest_source_date DESC,
            e.verified DESC,
            e.updated_at DESC,
            LOWER(e.name) ASC
        """,
        "source_count": """
            source_count DESC,
            latest_source_date DESC,
            e.verified DESC,
            LOWER(e.name) ASC
        """,
        "recent": """
            latest_source_date DESC,
            source_count DESC,
            e.verified DESC,
            LOWER(e.name) ASC
        """,
        "name": """
            LOWER(e.name) ASC,
            source_count DESC,
            latest_source_date DESC,
            e.verified DESC
        """,
    }
    if sort not in clauses:
        raise _invalid_entity_sort(sort)
    return clauses[sort]


def _invalid_entity_sort(sort: str) -> ValueError:
    return ValueError(f"Invalid entity sort: {sort}")


def _facet_rows_to_dicts(rows: list[tuple[Any, Any]]) -> list[dict[str, Any]]:
    """Convert raw facet SQL rows into API-friendly dictionaries."""
    return [{"value": value, "count": int(count)} for value, count in rows]


def _place_label(row: dict[str, Any]) -> str | None:
    """Build the shortest honest place label for a map point."""
    city = row.get("city")
    state = row.get("state")
    region = row.get("region")
    if city and state:
        return f"{city}, {state}"
    if city:
        return str(city)
    if region and state:
        return f"{region}, {state}"
    if region:
        return str(region)
    if state:
        return str(state)
    return None


def _date_prefix(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value[:10]


def _latest_source_date(sources: Sequence[dict[str, Any]]) -> str | None:
    """Return the newest source date the map can show without loading sources."""
    dates = [
        candidate
        for source in sources
        if (
            candidate := (
                source.get("published_date")
                or _date_prefix(source.get("ingested_at"))
                or _date_prefix(source.get("created_at"))
            )
        )
    ]
    if not dates:
        return None
    return max(str(value) for value in dates)


def _suppressed_source_ids(row: dict[str, Any]) -> set[str]:
    raw = row.get("suppressed_source_ids")
    if not isinstance(raw, str) or not raw.strip():
        return set()
    decoded = db.decode_json(raw)
    if not isinstance(decoded, list):
        return set()
    return {str(item) for item in decoded}


def _public_map_sources(row: dict[str, Any], sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    suppressed_ids = _suppressed_source_ids(row)
    if not suppressed_ids:
        return sources
    return [source for source in sources if source["id"] not in suppressed_ids]


def _empty_facets() -> dict[str, list[dict[str, Any]]]:
    """Return an empty public-search facet payload."""
    return {
        "states": [],
        "cities": [],
        "regions": [],
        "issue_areas": [],
        "entity_types": [],
        "source_types": [],
        "source_patterns": [],
    }


def _source_pattern_having_clause(source_patterns: Sequence[str]) -> str:
    """Build a source-pattern HAVING clause from a controlled vocabulary."""
    clauses: list[str] = []
    if "single_source" in source_patterns:
        clauses.append("COUNT(DISTINCT es_patterns.source_id) = 1")
    if "multi_source" in source_patterns:
        clauses.append("COUNT(DISTINCT es_patterns.source_id) >= 2")
    if "social_only" in source_patterns:
        clauses.append(
            """
            (
                COUNT(DISTINCT es_patterns.source_id) > 0
                AND SUM(CASE WHEN s_patterns.type <> 'social_media' THEN 1 ELSE 0 END) = 0
            )
            """
        )
    if not clauses:
        return "0 = 1"
    return " OR ".join(f"({clause})" for clause in clauses)
