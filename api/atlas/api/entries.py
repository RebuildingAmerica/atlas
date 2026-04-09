"""Entry endpoints."""

import logging
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from atlas.config import Settings, get_settings
from atlas.models import EntryCRUD, get_db_connection
from atlas.schemas import (
    EntryCreateRequest,
    EntryDetailResponse,
    EntryListResponse,
    EntryResponse,
    EntrySearchFacets,
    EntryUpdateRequest,
    FacetOption,
    PaginationResponse,
    SourceResponse,
)
from atlas.taxonomy import ALL_ISSUE_SLUGS

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


async def get_db(settings: Settings = Depends(get_settings)) -> AsyncGenerator:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url)
    try:
        yield conn
    finally:
        await conn.close()


@router.get("", response_model=EntryListResponse)
async def list_entries(  # noqa: PLR0913
    query: str | None = Query(None),
    state: list[str] | None = Query(None),
    city: list[str] | None = Query(None),
    region: list[str] | None = Query(None),
    entry_type: list[str] | None = Query(None),
    issue_area: list[str] | None = Query(None),
    source_type: list[str] | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncGenerator = Depends(get_db),
) -> EntryListResponse:
    """
    Search public entry results across multiple facets.

    Query Parameters:
    - query: full-text search against entity names and descriptions
    - state, city, region: geographic filters (repeatable)
    - entry_type: repeatable entity-type filter
    - issue_area: repeatable issue-area filter
    - source_type: repeatable source/mention-type filter
    - limit: results per page (default: 20, max: 100)
    - offset: pagination offset (default: 0)
    """
    invalid_issue_areas = [
        value
        for value in issue_area or []
        if value not in ALL_ISSUE_SLUGS
    ]
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
        entry_types=entry_type,
        source_types=source_type,
        limit=limit,
        offset=offset,
    )

    entries = [
        _entry_to_response(
            record["entry"],
            issue_areas=record["issue_areas"],
            source_types=record["source_types"],
            source_count=record["source_count"],
            latest_source_date=record["latest_source_date"],
        )
        for record in search_results["entries"]
    ]
    total = search_results["total"]

    return EntryListResponse(
        data=entries,
        pagination=PaginationResponse(
            limit=limit,
            offset=offset,
            total=total,
            has_more=offset + limit < total,
        ),
        facets=_facets_to_response(search_results["facets"]),
    )


@router.get("/{entry_id}", response_model=EntryDetailResponse)
async def get_entry(
    entry_id: str,
    db: AsyncGenerator = Depends(get_db),
) -> EntryDetailResponse:
    """Get a single entry by ID with full source provenance."""
    entry, sources = await EntryCRUD.get_with_sources(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    return _entry_to_detail_response(
        entry,
        issue_areas=issue_areas,
        sources=sources,
    )


@router.post("", response_model=EntryDetailResponse, status_code=201)
async def create_entry(
    req: EntryCreateRequest,
    db: AsyncGenerator = Depends(get_db),
) -> EntryDetailResponse:
    """
    Create a new entry.

    Validates issue areas against the taxonomy.
    """
    invalid_issue_areas = [
        issue_area
        for issue_area in req.issue_areas
        if issue_area not in ALL_ISSUE_SLUGS
    ]
    if invalid_issue_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue area(s): {', '.join(invalid_issue_areas)}",
        )

    entry_id = await EntryCRUD.create(
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
            (entry_id, linked_issue_area),
        )
    await db.commit()

    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=500, detail="Failed to create entry")

    return _entry_to_detail_response(
        entry,
        issue_areas=req.issue_areas,
        sources=[],
    )


@router.patch("/{entry_id}", response_model=EntryDetailResponse)
async def update_entry(
    entry_id: str,
    req: EntryUpdateRequest,
    db: AsyncGenerator = Depends(get_db),
) -> EntryDetailResponse:
    """Update an entry (partial update)."""
    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    update_dict = {
        field: value
        for field, value in req.model_dump(exclude_unset=True).items()
        if value is not None
    }

    if update_dict:
        await EntryCRUD.update(db, entry_id, **update_dict)

    updated_entry, sources = await EntryCRUD.get_with_sources(db, entry_id)
    if not updated_entry:
        raise HTTPException(status_code=500, detail="Failed to update entry")

    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    return _entry_to_detail_response(
        updated_entry,
        issue_areas=issue_areas,
        sources=sources,
    )


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: str,
    db: AsyncGenerator = Depends(get_db),
) -> None:
    """Delete an entry."""
    success = await EntryCRUD.delete(db, entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Entry not found")


def _entry_to_response(
    entry: Any,
    *,
    issue_areas: list[str],
    source_types: list[str],
    source_count: int,
    latest_source_date: str | None,
) -> EntryResponse:
    """Convert EntryModel to a public search response."""
    return EntryResponse(
        id=entry.id,
        type=entry.type,
        name=entry.name,
        description=entry.description,
        city=entry.city,
        state=entry.state,
        region=entry.region,
        full_address=entry.full_address,
        geo_specificity=entry.geo_specificity,
        website=entry.website,
        email=entry.email,
        phone=entry.phone,
        social_media=entry.social_media,
        affiliated_org_id=entry.affiliated_org_id,
        active=entry.active,
        verified=entry.verified,
        last_verified=entry.last_verified.isoformat() if entry.last_verified else None,
        first_seen=entry.first_seen.isoformat(),
        last_seen=entry.last_seen.isoformat(),
        issue_areas=issue_areas,
        source_types=source_types,
        source_count=source_count,
        latest_source_date=latest_source_date,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def _entry_to_detail_response(
    entry: Any,
    *,
    issue_areas: list[str],
    sources: list[dict[str, Any]],
) -> EntryDetailResponse:
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
    return EntryDetailResponse(
        **_entry_to_response(
            entry,
            issue_areas=issue_areas,
            source_types=source_types,
            source_count=len(sources),
            latest_source_date=latest_source_date,
        ).model_dump(),
        sources=[
            SourceResponse(
                id=source["id"],
                url=source["url"],
                title=source["title"],
                publication=source["publication"],
                published_date=source["published_date"],
                type=source["type"],
                ingested_at=source["ingested_at"],
                extraction_method=source["extraction_method"],
                extraction_context=source["extraction_context"],
                created_at=source["created_at"],
            )
            for source in sources
        ],
    )


def _facets_to_response(facets: dict[str, list[dict[str, Any]]]) -> EntrySearchFacets:
    """Convert raw facet dictionaries into response models."""
    return EntrySearchFacets(
        states=[FacetOption(**option) for option in facets["states"]],
        cities=[FacetOption(**option) for option in facets["cities"]],
        regions=[FacetOption(**option) for option in facets["regions"]],
        issue_areas=[FacetOption(**option) for option in facets["issue_areas"]],
        entity_types=[FacetOption(**option) for option in facets["entity_types"]],
        source_types=[FacetOption(**option) for option in facets["source_types"]],
    )
