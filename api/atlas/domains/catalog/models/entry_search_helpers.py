"""Helper functions for catalog entry search and map projections."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db
from atlas.platform.dates import date_string

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

__all__ = [
    "_date_prefix",
    "_empty_facets",
    "_entry_place_clause",
    "_entry_search_order_clause",
    "_facet_rows_to_dicts",
    "_invalid_entity_sort",
    "_latest_source_date",
    "_make_placeholders",
    "_place_filter_or_clause",
    "_place_label",
    "_public_map_sources",
    "_source_pattern_having_clause",
    "_suppressed_source_ids",
]


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
    if not isinstance(value, date | datetime | str) or not value:
        return None
    return date_string(value)


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


def _entry_place_clause(
    *,
    states: list[str] | None,
    cities: list[str] | None,
    regions: list[str] | None,
    place_filters: Sequence[Mapping[str, str | None]] | None,
    params: list[Any],
) -> str | None:
    """Build the geography predicate for public entry search."""
    if place_filters is not None:
        clause = _place_filter_or_clause(place_filters, params)
        return f" AND ({clause})" if clause else None

    clauses: list[str] = []
    if states:
        clauses.append(f"e.state IN ({_make_placeholders(states)})")
        params.extend(states)
    if cities:
        clauses.append(f"e.city IN ({_make_placeholders(cities)})")
        params.extend(cities)
    if regions:
        clauses.append(f"e.region IN ({_make_placeholders(regions)})")
        params.extend(regions)
    return " AND " + " AND ".join(clauses) if clauses else ""


def _place_filter_or_clause(
    place_filters: Sequence[Mapping[str, str | None]],
    params: list[Any],
) -> str | None:
    """Build exact place-scope filters without city/state cross products."""
    filter_clauses: list[str] = []
    for place_filter in place_filters:
        filter_parts: list[str] = []
        if place_filter.get("state"):
            filter_parts.append("e.state = ?")
            params.append(place_filter["state"])
        if place_filter.get("city"):
            filter_parts.append("e.city = ?")
            params.append(place_filter["city"])
        if place_filter.get("region"):
            filter_parts.append("e.region = ?")
            params.append(place_filter["region"])
        if filter_parts:
            filter_clauses.append("(" + " AND ".join(filter_parts) + ")")
    return " OR ".join(filter_clauses) or None


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
