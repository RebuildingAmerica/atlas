"""Backend query helpers for catalog entry search."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry_model import _hydrate_atproto_identities, _row_to_entry

from .entry_search_helpers import (
    _empty_facets,
    _entry_place_clause,
    _entry_search_order_clause,
    _make_placeholders,
    _source_pattern_having_clause,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    import aiosqlite


_BICYCLE_WORD = re.compile(r"\b(?:bikes?|bicycles?|bicycling|biking)\b", re.IGNORECASE)
_BICYCLE_VARIANTS = ("bike", "bikes", "bicycle", "bicycles", "bicycling", "biking")
_SEARCH_TERMS = re.compile(r"[^\W_]+", re.UNICODE)


def _text_query_variants(query: str) -> tuple[str, ...]:
    """Match ordinary bicycle wording without dropping the visitor's other terms."""
    if not _BICYCLE_WORD.search(query):
        return (query,)
    return tuple(
        dict.fromkeys((query, *(_BICYCLE_WORD.sub(word, query) for word in _BICYCLE_VARIANTS)))
    )


def _sqlite_fts_query(query: str) -> str:
    """Treat visitor punctuation as separators, not full-text query syntax."""
    return " ".join(f'"{term}"' for term in _SEARCH_TERMS.findall(query))


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
        # Both text indexes cover name and description only, so place matches
        # separately.
        if not _SEARCH_TERMS.search(query):
            return []
        text_variants = _text_query_variants(query)
        if getattr(conn, "backend", None) == "postgres":
            search_values = text_variants
            text_matches = " OR ".join(
                "e.search_vector @@ plainto_tsquery('english', ?)" for _ in text_variants
            )
            query_sql += f"""
                AND (
                    ({text_matches})
                    OR LOWER(e.city) LIKE ?
                    OR LOWER(e.state) = LOWER(?)
                )
            """
        else:
            search_values = tuple(_sqlite_fts_query(variant) for variant in text_variants)
            text_matches = " OR ".join(
                "e.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)"
                for _ in text_variants
            )
            query_sql += f"""
                AND (
                    ({text_matches})
                    OR LOWER(e.city) LIKE ?
                    OR LOWER(e.state) = LOWER(?)
                )
            """
        # psycopg reads a literal % in the statement as a placeholder, so the
        # wildcard goes in the parameter.
        params.extend([*search_values, f"{query.lower()}%", query])
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
            MAX(s.published_date) AS latest_source_date
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
    entries = [record["entry"] for record in records]
    await _hydrate_atproto_identities(conn, entries)
    return records


async def build_facets(
    conn: aiosqlite.Connection,
    entry_ids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """Build search facet buckets for a set of entry IDs."""
    if not entry_ids:
        return _empty_facets()

    placeholders = _make_placeholders(entry_ids)
    # One database trip keeps every search filter available without seven
    # serial network waits or seven separately billed Hyperdrive queries.
    cursor = await conn.execute(
        f"""
        WITH selected_entries AS (
            SELECT id, state, city, region, type
            FROM entries WHERE id IN ({placeholders})
        ), selected_entry_sources AS (
            SELECT es.entry_id, es.source_id
            FROM entry_sources es
            JOIN selected_entries e ON e.id = es.entry_id
        ), source_patterns AS (
            SELECT entry_id,
                CASE
                    WHEN COUNT(DISTINCT source_id) = 1 THEN 'single_source'
                    WHEN COUNT(DISTINCT source_id) >= 2 THEN 'multi_source'
                END AS source_pattern
            FROM selected_entry_sources
            GROUP BY entry_id

            UNION ALL

            SELECT es.entry_id, 'social_only' AS source_pattern
            FROM selected_entry_sources es
            JOIN sources s ON s.id = es.source_id
            GROUP BY es.entry_id
            HAVING COUNT(DISTINCT es.source_id) > 0
               AND SUM(CASE WHEN s.type <> 'social_media' THEN 1 ELSE 0 END) = 0
        )
        SELECT 'states' AS bucket, state AS value, COUNT(*) AS frequency
        FROM selected_entries WHERE state IS NOT NULL GROUP BY state

        UNION ALL
        SELECT 'cities', city, COUNT(*)
        FROM selected_entries WHERE city IS NOT NULL GROUP BY city

        UNION ALL
        SELECT 'regions', region, COUNT(*)
        FROM selected_entries WHERE region IS NOT NULL GROUP BY region

        UNION ALL
        SELECT 'issue_areas', eia.issue_area, COUNT(*)
        FROM entry_issue_areas eia
        JOIN selected_entries e ON e.id = eia.entry_id
        GROUP BY eia.issue_area

        UNION ALL
        SELECT 'entity_types', type, COUNT(*)
        FROM selected_entries GROUP BY type

        UNION ALL
        SELECT 'source_types', s.type, COUNT(DISTINCT es.entry_id)
        FROM selected_entry_sources es
        JOIN sources s ON s.id = es.source_id
        GROUP BY s.type

        UNION ALL
        SELECT 'source_patterns', source_pattern, COUNT(*)
        FROM source_patterns WHERE source_pattern IS NOT NULL
        GROUP BY source_pattern

        ORDER BY bucket, frequency DESC, value ASC
        """,
        entry_ids,
    )
    facets = _empty_facets()
    for bucket, value, count in await cursor.fetchall():
        facets[bucket].append({"value": value, "count": int(count)})
    return facets
