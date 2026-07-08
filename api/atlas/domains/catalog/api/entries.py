"""Entity endpoints."""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from atlas.domains.catalog.models.connections import compute_connections
from atlas.domains.catalog.schemas.public import (
    EntityConnectionsResponse,
    MapPoint,
    MapPointCollectionResponse,
)
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.models import EntryCRUD, FlagCRUD
from atlas.platform.http.cache import apply_short_public_cache
from atlas.schemas import (
    EntityCollectionResponse,
    EntityDetailResponse,
    EntitySourcesResponse,
    SourceResponse,
)

from .entries_support import (
    _entity_to_detail_response,
    _entity_to_response,
    _facets_to_response,
    _normalize_multi_value_query,
    _source_linked_entity_record,
    _source_record,
    get_db,
)

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

router = APIRouter()

from . import entries_write  # noqa: E402, F401

__all__ = ["router"]


@router.get(
    "",
    response_model=EntityCollectionResponse,
    summary="List entities",
    description="Search Atlas entities with text, geography, issue-area, entity-type, and source-type filters.",
    operation_id="listEntities",
    response_description="A paginated collection of Atlas entities.",
    tags=["entities"],
)
async def list_entities(  # noqa: PLR0913
    response: Response,
    query: str | None = Query(None),
    state: list[str] | None = Query(None),
    city: list[str] | None = Query(None),
    region: list[str] | None = Query(None),
    entity_type: list[str] | None = Query(None),
    issue_area: list[str] | None = Query(None),
    source_type: list[str] | None = Query(None),
    source_pattern: list[str] | None = Query(None),
    affiliated_org_id: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityCollectionResponse:
    """
    Search public entity results across multiple facets.

    Query Parameters:
    - query: full-text search against entity names and descriptions
    - state, city, region: geographic filters (repeatable)
    - entity_type: repeatable entity-type filter
    - issue_area: repeatable issue-area filter
    - source_type: repeatable source/mention-type filter
    - source_pattern: repeatable trust pattern filter (single_source, multi_source, social_only)
    - limit: results per page (default: 20, max: 100)
    - cursor: pagination cursor (default: 0)
    """
    offset = int(cursor) if cursor else 0
    state = _normalize_multi_value_query(state)
    city = _normalize_multi_value_query(city)
    region = _normalize_multi_value_query(region)
    entity_type = _normalize_multi_value_query(entity_type)
    issue_area = _normalize_multi_value_query(issue_area)
    source_type = _normalize_multi_value_query(source_type)
    source_pattern = _normalize_multi_value_query(source_pattern)
    invalid_issue_areas = [value for value in issue_area or [] if value not in ALL_ISSUE_SLUGS]
    if invalid_issue_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue area(s): {', '.join(invalid_issue_areas)}",
        )

    search_results = await EntryCRUD.search_public(
        db,
        query=query,
        states=state,
        cities=city,
        regions=region,
        issue_areas=issue_area,
        entry_types=entity_type,
        source_types=source_type,
        source_patterns=source_pattern,
        affiliated_org_id=affiliated_org_id,
        limit=limit,
        offset=offset,
    )
    entity_ids = [record["entry"].id for record in search_results["entries"]]
    flag_summaries = await FlagCRUD.entity_flag_summaries(db, entity_ids)

    entities = [
        _entity_to_response(
            record["entry"],
            issue_areas=record["issue_areas"],
            source_types=record["source_types"],
            source_count=record["source_count"],
            latest_source_date=record["latest_source_date"],
            flag_summary=flag_summaries.get(record["entry"].id),
        )
        for record in search_results["entries"]
    ]
    total = search_results["total"]

    next_cursor = str(offset + limit) if offset + limit < total else None
    apply_short_public_cache(response)
    return EntityCollectionResponse(
        items=entities,
        total=total,
        next_cursor=next_cursor,
        facets=_facets_to_response(search_results["facets"]),
    )


@router.get(
    "/map",
    response_model=MapPointCollectionResponse,
    summary="Map points in a viewport",
    description="Return placed civic actors inside a bounding box, filtered by the browse facets, as a tiny projection for the map.",
    operation_id="getEntitiesMap",
    response_description="A capped collection of placed actors for the requested viewport.",
    tags=["entities"],
)
async def get_entities_map(  # noqa: PLR0913
    response: Response,
    min_lng: float = Query(..., description="Western edge of the viewport."),
    min_lat: float = Query(..., description="Southern edge of the viewport."),
    max_lng: float = Query(..., description="Eastern edge of the viewport."),
    max_lat: float = Query(..., description="Northern edge of the viewport."),
    query: str | None = Query(None),
    state: list[str] | None = Query(None),
    city: list[str] | None = Query(None),
    region: list[str] | None = Query(None),
    entity_type: list[str] | None = Query(None),
    issue_area: list[str] | None = Query(None),
    source_type: list[str] | None = Query(None),
    source_pattern: list[str] | None = Query(None),
    limit: int = Query(2000, ge=1, le=5000),
    db: aiosqlite.Connection = Depends(get_db),
) -> MapPointCollectionResponse:
    """Resolve a viewport into placed actors using the browse facet filters.

    Reuses the exact list-entities facet vocabulary so the map and the browse
    list stay in lockstep, then keeps only the rows that carry coordinates inside
    the bounding box. The payload is capped at ``limit``; when a viewport holds
    more, ``capped`` is true so the experience can honestly say "zoom in to see
    all" rather than silently dropping actors.
    """
    state = _normalize_multi_value_query(state)
    city = _normalize_multi_value_query(city)
    region = _normalize_multi_value_query(region)
    entity_type = _normalize_multi_value_query(entity_type)
    issue_area = _normalize_multi_value_query(issue_area)
    source_type = _normalize_multi_value_query(source_type)
    source_pattern = _normalize_multi_value_query(source_pattern)
    invalid_issue_areas = [value for value in issue_area or [] if value not in ALL_ISSUE_SLUGS]
    if invalid_issue_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue area(s): {', '.join(invalid_issue_areas)}",
        )

    result = await EntryCRUD.search_map_points(
        db,
        min_lng=min_lng,
        min_lat=min_lat,
        max_lng=max_lng,
        max_lat=max_lat,
        query=query,
        states=state,
        cities=city,
        regions=region,
        issue_areas=issue_area,
        entry_types=entity_type,
        source_types=source_type,
        source_patterns=source_pattern,
        limit=limit,
    )
    apply_short_public_cache(response)
    return MapPointCollectionResponse(
        points=[MapPoint(**point) for point in result["points"]],
        total=result["total"],
        capped=result["capped"],
    )


@router.get(
    "/by-slug/{entity_type}/{slug}",
    response_model=None,
    summary="Resolve entity by slug",
    description="Resolve a type + slug pair to a full entity detail response.",
    operation_id="resolveEntityBySlug",
    tags=["entities"],
)
async def resolve_by_slug(
    entity_type: str,
    slug: str,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse | JSONResponse:
    """Resolve a type + slug pair to a full entity detail response.

    Returns the entity if the slug matches directly. If the slug is an
    alias (old slug replaced by a vanity slug), returns a 301 redirect
    to the canonical slug. Returns 404 if the slug is unknown or the
    entry type doesn't match.
    """
    type_map = {
        "people": "person",
        "organizations": "organization",
        "initiatives": "initiative",
        "campaigns": "campaign",
        "events": "event",
    }
    entry_type = type_map.get(entity_type)
    if entry_type is None:
        raise HTTPException(status_code=400, detail=f"Invalid entity type: {entity_type}")

    result = await EntryCRUD.resolve_slug(db, slug)
    if result is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    entry = result["entry"]
    if entry.type != entry_type:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await EntryCRUD.is_publicly_visible(db, entry.id):
        raise HTTPException(status_code=404, detail="Entity not found")

    if result["is_alias"]:
        canonical_slug = result["canonical_slug"]
        return JSONResponse(
            status_code=301,
            headers={"Location": f"/api/entities/by-slug/{entity_type}/{canonical_slug}"},
            content={"redirect_to": f"/api/entities/by-slug/{entity_type}/{canonical_slug}"},
        )

    _entry, sources = await EntryCRUD.get_with_sources(db, entry.id)
    issue_areas = await EntryCRUD.get_issue_areas(db, entry.id)
    entity_flag_summaries = await FlagCRUD.entity_flag_summaries(db, [entry.id])
    source_flag_summaries = await FlagCRUD.source_flag_summaries(
        db, [source["id"] for source in sources]
    )
    apply_short_public_cache(response)
    return _entity_to_detail_response(
        entry,
        issue_areas=issue_areas,
        sources=sources,
        flag_summary=entity_flag_summaries.get(entry.id),
        source_flag_summaries=source_flag_summaries,
    )


@router.get(
    "/{entry_id}/connections",
    response_model=EntityConnectionsResponse,
    summary="Get entity connections",
    description="Return related actors ranked by connection strength, with the reasons behind each link.",
    operation_id="getEntityConnections",
    tags=["entities"],
)
async def get_entity_connections(
    entry_id: str,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> EntityConnectionsResponse:
    """Compute the ranked connection network for an entry.

    Merges organizational affiliation, source co-mentions, and shared issue
    areas within the same state into one strength-ranked, deduped list, nudged
    by shared geography. Reports the true total before pagination so the count
    is never a fake cap.
    """
    if not await EntryCRUD.is_publicly_visible(db, entry_id):
        raise HTTPException(status_code=404, detail="Entity not found")

    result = await compute_connections(db, entry_id, limit=limit, offset=offset)
    apply_short_public_cache(response)
    return EntityConnectionsResponse.model_validate(asdict(result))


@router.get(
    "/{entity_id}",
    response_model=EntityDetailResponse,
    summary="Get an entity",
    description="Return one Atlas entity with normalized contact, freshness, flag summary, and linked source provenance.",
    operation_id="getEntity",
    response_description="The requested Atlas entity.",
    tags=["entities"],
)
async def get_entity(
    entity_id: str,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Get a single entity by ID with full source provenance."""
    if not await EntryCRUD.is_publicly_visible(db, entity_id):
        raise HTTPException(status_code=404, detail="Entity not found")

    entry, sources = await EntryCRUD.get_with_sources(db, entity_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entity not found")

    issue_areas = await EntryCRUD.get_issue_areas(db, entity_id)
    entity_flag_summaries = await FlagCRUD.entity_flag_summaries(db, [entity_id])
    source_flag_summaries = await FlagCRUD.source_flag_summaries(
        db, [source["id"] for source in sources]
    )
    apply_short_public_cache(response)
    return _entity_to_detail_response(
        entry,
        issue_areas=issue_areas,
        sources=sources,
        flag_summary=entity_flag_summaries.get(entity_id),
        source_flag_summaries=source_flag_summaries,
    )


@router.get(
    "/{entity_id}/sources",
    response_model=EntitySourcesResponse,
    summary="List entity sources",
    description="Return the source trail for one Atlas entity.",
    operation_id="listEntitySources",
    response_description="The source records linked to the requested entity.",
    tags=["entities"],
)
async def get_entity_sources(
    entity_id: str,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> EntitySourcesResponse:
    """Get source provenance for one entity."""
    if not await EntryCRUD.is_publicly_visible(db, entity_id):
        raise HTTPException(status_code=404, detail="Entity not found")

    entry, sources = await EntryCRUD.get_with_sources(db, entity_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entity not found")

    issue_areas = await EntryCRUD.get_issue_areas(db, entity_id)
    source_flag_summaries = await FlagCRUD.source_flag_summaries(
        db, [source["id"] for source in sources]
    )
    apply_short_public_cache(response)
    return EntitySourcesResponse(
        entity_id=entity_id,
        sources=[
            SourceResponse.model_validate(
                _source_record(
                    source,
                    linked_entity_ids=[entity_id],
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
