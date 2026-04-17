"""Place-first public API endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_short_public_cache, apply_static_public_cache
from atlas.platform.mcp.data import AtlasDataService, normalize_place_key
from atlas.schemas import (
    EntityCollectionResponse,
    IssueSignalsResponse,
    PlaceCoverageResponse,
    PlaceIdentityResponse,
    PlaceProfileResponse,
    SourceCollectionResponse,
)

if TYPE_CHECKING:
    import aiosqlite

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


def _get_service(settings: Settings) -> AtlasDataService:
    return AtlasDataService(settings.database_url)


@router.get(
    "/places/{place_key}",
    response_model=PlaceIdentityResponse,
    summary="Get a place",
    description="Return the canonical Atlas identity for a normalized place key.",
    operation_id="getPlace",
    response_description="The canonical Atlas place resource.",
    tags=["places"],
)
async def get_place(
    place_key: str,
    response: Response,
) -> PlaceIdentityResponse:
    """Return canonical information about a place resource."""
    normalized_place = normalize_place_key(place_key)
    apply_short_public_cache(response)
    return PlaceIdentityResponse.model_validate(
        {
            "place": normalized_place,
            "resource_uri": f"atlas://places/{place_key}",
        }
    )


@router.get(
    "/places/{place_key}/entities",
    response_model=EntityCollectionResponse,
    summary="List place entities",
    description="List Atlas entities associated with one place, with optional issue-area, entity-type, source-type, and text filters.",
    operation_id="listPlaceEntities",
    response_description="A paginated collection of Atlas entities for the requested place.",
    tags=["places"],
)
async def get_place_entities(  # noqa: PLR0913
    place_key: str,
    response: Response,
    issue_area: list[str] | None = Query(None),
    entity_type: list[str] | None = Query(None),
    source_type: list[str] | None = Query(None),
    text: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> EntityCollectionResponse:
    """Return entities for a place."""
    service = _get_service(settings)
    try:
        issue_area = _normalize_multi_value_query(issue_area)
        entity_type = _normalize_multi_value_query(entity_type)
        source_type = _normalize_multi_value_query(source_type)
        apply_short_public_cache(response)
        return EntityCollectionResponse.model_validate(
            await service.get_place_entities(
                normalize_place_key(place_key),
                issue_areas=issue_area,
                entity_types=entity_type,
                source_types=source_type,
                text=text,
                limit=limit,
                cursor=cursor,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/places/{place_key}/sources",
    response_model=SourceCollectionResponse,
    summary="List place sources",
    description="List source records associated with one place, with optional issue-area, source-type, and text filters.",
    operation_id="listPlaceSources",
    response_description="A paginated collection of Atlas sources for the requested place.",
    tags=["places"],
)
async def get_place_sources(  # noqa: PLR0913
    place_key: str,
    response: Response,
    issue_area: list[str] | None = Query(None),
    source_type: list[str] | None = Query(None),
    text: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> SourceCollectionResponse:
    """Return sources for a place."""
    service = _get_service(settings)
    try:
        issue_area = _normalize_multi_value_query(issue_area)
        source_type = _normalize_multi_value_query(source_type)
        apply_short_public_cache(response)
        return SourceCollectionResponse.model_validate(
            await service.get_place_sources(
                normalize_place_key(place_key),
                issue_areas=issue_area,
                source_types=source_type,
                text=text,
                limit=limit,
                cursor=cursor,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/places/{place_key}/issue-signals",
    response_model=IssueSignalsResponse,
    summary="Get place issue signals",
    description="Return structured issue-area signals for one place based on Atlas entities and sources.",
    operation_id="getPlaceIssueSignals",
    response_description="Issue-area signal summaries for the requested place.",
    tags=["places"],
)
async def get_place_issue_signals(
    place_key: str,
    response: Response,
    issue_area: list[str] | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> IssueSignalsResponse:
    """Return issue signals for a place."""
    service = _get_service(settings)
    try:
        issue_area = _normalize_multi_value_query(issue_area)
        apply_short_public_cache(response)
        return IssueSignalsResponse.model_validate(
            await service.get_place_issue_signals(
                normalize_place_key(place_key),
                issue_areas=issue_area,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/places/{place_key}/coverage",
    response_model=PlaceCoverageResponse,
    summary="Get place coverage",
    description="Return Atlas coverage counts and gaps for one place.",
    operation_id="getPlaceCoverage",
    response_description="Atlas coverage metadata for the requested place.",
    tags=["places"],
)
async def get_place_coverage(
    place_key: str,
    response: Response,
    issue_area: list[str] | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> PlaceCoverageResponse:
    """Return Atlas coverage for a place."""
    service = _get_service(settings)
    try:
        issue_area = _normalize_multi_value_query(issue_area)
        apply_short_public_cache(response)
        return PlaceCoverageResponse.model_validate(
            await service.get_place_coverage(
                normalize_place_key(place_key),
                issue_areas=issue_area,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/places/{place_key}/profile",
    response_model=PlaceProfileResponse,
    summary="Get a place profile",
    description="Return structured demographic and socioeconomic context for one place.",
    operation_id="getPlaceProfile",
    response_description="The Atlas place profile for the requested place.",
    tags=["places"],
)
async def get_place_profile(
    place_key: str,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> PlaceProfileResponse:
    """Return place demographic and socioeconomic context."""
    service = _get_service(settings)
    try:
        apply_static_public_cache(response)
        return PlaceProfileResponse.model_validate(
            await service.get_place_profile(normalize_place_key(place_key))
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
