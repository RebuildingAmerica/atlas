"""Support helpers for catalog entity endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import Depends

from atlas.domains.catalog.schemas.public import (
    FacetOption,
    SourceResponse,
)
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.dates import date_string
from atlas.platform.mcp.data import (
    EntityRecordContext,
    _entity_record,
    _source_linked_entity_record,
    _source_record,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    import aiosqlite

from atlas.schemas import EntityDetailResponse, EntityResponse


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


__all__ = [
    "_entity_to_detail_response",
    "_entity_to_response",
    "_facets_to_response",
    "_normalize_multi_value_query",
    "_source_linked_entity_record",
    "_source_record",
    "get_db",
]


def _normalize_multi_value_query(values: list[str] | None) -> list[str] | None:
    """Accept repeated or comma-delimited query parameter values."""
    if not values:
        return values
    normalized: list[str] = []
    for value in values:
        normalized.extend(part.strip() for part in value.split(",") if part.strip())
    return normalized


def _entity_to_response(  # noqa: PLR0913
    entry: Any,
    *,
    issue_areas: list[str],
    source_types: list[str],
    source_count: int,
    latest_source_date: str | None,
    flag_summary: dict[str, Any] | None,
) -> EntityResponse:
    """Convert EntryModel to a public search response."""
    return EntityResponse.model_validate(
        _entity_record(
            entry,
            EntityRecordContext(
                issue_area_ids=issue_areas,
                source_types=source_types,
                source_count=source_count,
                latest_source_date=latest_source_date,
                flag_summary=flag_summary,
            ),
        )
    )


def _entity_to_detail_response(  # noqa: PLR0913
    entry: Any,
    *,
    issue_areas: list[str],
    sources: list[dict[str, Any]],
    flag_summary: dict[str, Any] | None,
    source_flag_summaries: dict[str, dict[str, Any]],
    include_suppressed: bool = False,
) -> EntityDetailResponse:
    """Convert EntryModel and linked sources into a detail response.

    Suppressed sources (hidden by the verified subject via the manage flow)
    are excluded from the public response. Pass ``include_suppressed=True``
    for admin or subject-self views.
    """
    suppressed_ids = set(getattr(entry, "suppressed_source_ids", []) or [])
    if suppressed_ids and not include_suppressed:
        sources = [source for source in sources if source["id"] not in suppressed_ids]
    source_types = sorted({source["type"] for source in sources})
    latest_source_date = next(
        (
            date_string(source.get("published_date") or source.get("ingested_at"))
            for source in sources
            if source.get("published_date") or source.get("ingested_at")
        ),
        None,
    )
    return EntityDetailResponse(
        **_entity_to_response(
            entry,
            issue_areas=issue_areas,
            source_types=source_types,
            source_count=len(sources),
            latest_source_date=latest_source_date,
            flag_summary=flag_summary,
        ).model_dump(),
        sources=[
            SourceResponse.model_validate(
                _source_record(
                    source,
                    linked_entity_ids=[entry.id],
                    linked_entities=[
                        _source_linked_entity_record(entry, issue_area_ids=issue_areas)
                    ],
                    extraction_context=source["extraction_context"],
                    flag_summary=source_flag_summaries.get(source["id"]),
                )
            )
            for source in sources
        ],
    )


def _facets_to_response(facets: dict[str, list[dict[str, Any]]]) -> dict[str, list[FacetOption]]:
    """Convert raw facet dictionaries into response models."""
    return {
        "states": [FacetOption(**option) for option in facets["states"]],
        "cities": [FacetOption(**option) for option in facets["cities"]],
        "regions": [FacetOption(**option) for option in facets["regions"]],
        "issue_areas": [FacetOption(**option) for option in facets["issue_areas"]],
        "entity_types": [FacetOption(**option) for option in facets["entity_types"]],
        "source_types": [FacetOption(**option) for option in facets["source_types"]],
        "source_patterns": [FacetOption(**option) for option in facets["source_patterns"]],
    }
