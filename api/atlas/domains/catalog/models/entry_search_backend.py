"""Backend query helpers for catalog entry search."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry_model import _row_to_entry

from .entry_search_helpers import (
    _empty_facets,
    _entry_place_clause,
    _entry_search_order_clause,
    _facet_rows_to_dicts,
    _make_placeholders,
    _source_pattern_having_clause,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    import aiosqlite


async def search_public_ids(  # noqa: PLR0913
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
    """Return entry IDs matching the public search filters."""
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
    params: list[Any] = []

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
    place_clause = _entry_place_clause(
        states=states,
        cities=cities,
        regions=regions,
        place_filters=place_filters,
        params=params,
    )
    if place_clause is None:
        return []
    query_sql += place_clause
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


async def load_entries_with_metrics(
    conn: aiosqlite.Connection,
    entry_ids: list[str],
    sort: str,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    """Load entries with aggregate source metrics for search results."""
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


async def build_facets(
    conn: aiosqlite.Connection,
    entry_ids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """Build search facet buckets for a set of entry IDs."""
    if not entry_ids:
        return _empty_facets()

    placeholders = _make_placeholders(entry_ids)
    params = entry_ids

    async def fetch_pairs(sql: str, query_params: list[Any]) -> list[tuple[Any, Any]]:
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
