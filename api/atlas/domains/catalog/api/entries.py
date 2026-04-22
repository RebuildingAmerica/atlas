"""Entity endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from atlas.domains.access.dependencies import require_org_actor_permission
from atlas.domains.catalog.models.connections import compute_connections
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.schemas.public import FacetOption
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.models import EntryCRUD, FlagCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers, apply_short_public_cache
from atlas.platform.mcp.data import EntityRecordContext, _entity_record, _source_record
from atlas.schemas import (
    EntityCollectionResponse,
    EntityCreateRequest,
    EntityDetailResponse,
    EntityResponse,
    EntitySourcesResponse,
    EntityUpdateRequest,
    SourceResponse,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url)
    try:
        yield conn
    finally:
        await conn.close()


def _normalize_multi_value_query(values: list[str] | None) -> list[str] | None:
    """Accept repeated or comma-delimited query parameter values."""
    if not values:
        return values
    normalized: list[str] = []
    for value in values:
        normalized.extend(part.strip() for part in value.split(",") if part.strip())
    return normalized


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
    """Resolve a type + slug pair to an entity."""
    type_map = {"people": "person", "organizations": "organization"}
    entry_type = type_map.get(entity_type)
    if entry_type is None:
        raise HTTPException(status_code=400, detail=f"Invalid entity type: {entity_type}")

    result = await EntryCRUD.resolve_slug(db, slug)
    if result is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    entry = result["entry"]
    if entry.type != entry_type:
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
    summary="Get entity connections",
    description="Return related actors grouped by relationship type with evidence.",
    operation_id="getEntityConnections",
    tags=["entities"],
)
async def get_entity_connections(
    entry_id: str,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, list[dict[str, Any]]]:
    """Compute and return related actors for a given entry."""
    connections = await compute_connections(db, entry_id)
    apply_short_public_cache(response)
    return {"connections": connections}


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
    entry, sources = await EntryCRUD.get_with_sources(db, entity_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entity not found")

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
                    extraction_context=source["extraction_context"],
                    flag_summary=source_flag_summaries.get(source["id"]),
                )
            )
            for source in sources
        ],
    )


@router.post(
    "",
    response_model=EntityDetailResponse,
    status_code=201,
    summary="Create an entity",
    description="Create a new Atlas entity using the canonical nested address and contact request shape.",
    operation_id="createEntity",
    response_description="The newly created Atlas entity.",
    tags=["entities"],
)
async def create_entity(
    req: EntityCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor_permission("entities", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """
    Create a new entry.

    Validates issue areas against the taxonomy.
    """
    invalid_issue_areas = [
        issue_area for issue_area in req.issue_areas if issue_area not in ALL_ISSUE_SLUGS
    ]
    if invalid_issue_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue area(s): {', '.join(invalid_issue_areas)}",
        )

    assert req.geo_specificity is not None  # guaranteed by model validator
    entity_id = await EntryCRUD.create(
        db,
        entry_type=req.type,
        name=req.name,
        description=req.description,
        city=req.city,
        state=req.state,
        geo_specificity=req.geo_specificity,
        region=req.region,
        full_address=req.full_address,
        website=req.website,
        email=req.email,
        phone=req.phone,
        social_media=req.social_media,
        affiliated_org_id=req.affiliated_org_id,
        first_seen=req.first_seen,
        last_seen=req.last_seen,
        contact_status=req.contact_status,
        editorial_notes=req.editorial_notes,
        priority=req.priority,
    )

    for linked_issue_area in req.issue_areas:
        await db.execute(
            """
            INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
            VALUES (?, ?, datetime('now'))
            """,
            (entity_id, linked_issue_area),
        )
    await db.commit()

    assert actor.org_id is not None  # guaranteed by require_org_actor_permission
    await OwnershipCRUD.create_ownership(
        db,
        resource_id=entity_id,
        resource_type="entry",
        org_id=actor.org_id,
        visibility="public",
        created_by=actor.user_id,
    )

    entry = await EntryCRUD.get_by_id(db, entity_id)
    if not entry:
        raise HTTPException(status_code=500, detail="Failed to create entity")
    apply_no_store_headers(response)

    return _entity_to_detail_response(
        entry,
        issue_areas=req.issue_areas,
        sources=[],
        flag_summary=None,
        source_flag_summaries={},
    )


@router.patch(
    "/{entity_id}",
    response_model=EntityDetailResponse,
    summary="Update an entity",
    description="Apply a partial update to an Atlas entity.",
    operation_id="updateEntity",
    response_description="The updated Atlas entity.",
    tags=["entities"],
)
async def update_entity(
    entity_id: str,
    req: EntityUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor_permission("entities", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Update an entity (partial update)."""
    entry = await EntryCRUD.get_by_id(db, entity_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entity not found")

    ownership = await OwnershipCRUD.get_ownership(db, entity_id, "entry")
    if ownership is not None and ownership.org_id != actor.org_id:
        raise HTTPException(
            status_code=403, detail="Only the owning organization can modify this entity"
        )

    update_dict = {
        field: value
        for field, value in req.model_dump(exclude_unset=True).items()
        if value is not None
    }

    if update_dict:
        await EntryCRUD.update(db, entity_id, **update_dict)

    updated_entry, sources = await EntryCRUD.get_with_sources(db, entity_id)
    if not updated_entry:
        raise HTTPException(status_code=500, detail="Failed to update entity")

    issue_areas = await EntryCRUD.get_issue_areas(db, entity_id)
    apply_no_store_headers(response)
    return _entity_to_detail_response(
        updated_entry,
        issue_areas=issue_areas,
        sources=sources,
        flag_summary=(await FlagCRUD.entity_flag_summaries(db, [entity_id])).get(entity_id),
        source_flag_summaries=await FlagCRUD.source_flag_summaries(
            db, [source["id"] for source in sources]
        ),
    )


@router.delete(
    "/{entity_id}",
    status_code=204,
    summary="Delete an entity",
    description="Delete an Atlas entity by ID.",
    operation_id="deleteEntity",
    response_description="The entity was deleted.",
    tags=["entities"],
)
async def delete_entity(
    entity_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor_permission("entities", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete an entity."""
    entry = await EntryCRUD.get_by_id(db, entity_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entity not found")

    ownership = await OwnershipCRUD.get_ownership(db, entity_id, "entry")
    if ownership is not None and ownership.org_id != actor.org_id:
        raise HTTPException(
            status_code=403, detail="Only the owning organization can delete this entity"
        )

    await EntryCRUD.delete(db, entity_id)
    await OwnershipCRUD.delete_ownership(db, entity_id, "entry")
    apply_no_store_headers(response)


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


def _entity_to_detail_response(
    entry: Any,
    *,
    issue_areas: list[str],
    sources: list[dict[str, Any]],
    flag_summary: dict[str, Any] | None,
    source_flag_summaries: dict[str, dict[str, Any]],
) -> EntityDetailResponse:
    """Convert EntryModel and linked sources into a detail response."""
    source_types = sorted({source["type"] for source in sources})
    latest_source_date = next(
        (
            source["published_date"] or source["ingested_at"][:10]
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
    }
