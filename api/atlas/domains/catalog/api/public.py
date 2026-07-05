"""Place-first public API endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_short_public_cache, apply_static_public_cache
from atlas.platform.mcp.data import AtlasDataService, normalize_place_key
from atlas.schemas import (
    EntityCollectionResponse,
    IssueSignalsResponse,
    PlaceCoverageResponse,
    PlaceIdentityResponse,
    PlacePageContextResponse,
    PlaceProfileResponse,
    SourceCollectionResponse,
)

if TYPE_CHECKING:
    import aiosqlite

PlaceRouteKind = Literal[
    "polity",
    "borough",
    "city",
    "county",
    "metro",
    "neighborhood",
    "district",
    "service_area",
    "state",
]

router = APIRouter()

__all__ = ["router"]


class PublicDirectoryIndexItem(BaseModel):
    """One public workspace directory that can be indexed."""

    org_id: str
    record_count: int = Field(..., ge=1)
    last_published_at: str | None = None


class PublicDirectoryIndexResponse(BaseModel):
    """Public directories with source-backed published records."""

    directories: list[PublicDirectoryIndexItem]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
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
    "/public-directories",
    response_model=PublicDirectoryIndexResponse,
    summary="List public directories",
    description="List workspace directories that currently expose at least one published public record.",
    operation_id="listPublicDirectories",
    response_description="A collection of public directory URLs eligible for indexing.",
    tags=["org-entries"],
)
async def list_public_directories(
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> PublicDirectoryIndexResponse:
    """Return public directories with at least one published record."""
    directories = await OwnershipCRUD.list_public_directory_index(db)
    apply_short_public_cache(response)
    return PublicDirectoryIndexResponse(
        directories=[
            PublicDirectoryIndexItem(
                org_id=directory.org_id,
                record_count=directory.record_count,
                last_published_at=directory.last_published_at,
            )
            for directory in directories
        ]
    )


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
    "/places/{place_key}/page-context",
    response_model=PlacePageContextResponse,
    summary="Get place page context",
    description="Return the durable public context used to render one place page.",
    operation_id="getPlacePageContext",
    response_description="Public context for the requested place page.",
    tags=["places"],
)
async def get_place_page_context(
    place_key: str,
    response: Response,
    kind: PlaceRouteKind | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> PlacePageContextResponse:
    """Return database-backed public context for a place page."""
    service = _get_service(settings)
    try:
        apply_short_public_cache(response)
        return PlacePageContextResponse.model_validate(
            await service.get_place_page_context(normalize_place_key(place_key), kind=kind)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/places/{place_key}/entities",
    response_model=EntityCollectionResponse,
    summary="List place entities",
    description="List Atlas entities associated with one place, with optional issue-area, entity-type, source-type, text, and sort controls.",
    operation_id="listPlaceEntities",
    response_description="A paginated collection of Atlas entities for the requested place.",
    tags=["places"],
)
async def get_place_entities(  # noqa: PLR0913
    place_key: str,
    response: Response,
    kind: PlaceRouteKind | None = Query(None),
    issue_area: list[str] | None = Query(None),
    entity_type: list[str] | None = Query(None),
    source_type: list[str] | None = Query(None),
    text: str | None = Query(None),
    sort: Literal["relevance", "source_count", "recent", "name"] = Query("relevance"),
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
                kind=kind,
                issue_areas=issue_area,
                entity_types=entity_type,
                source_types=source_type,
                text=text,
                sort=sort,
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
    kind: PlaceRouteKind | None = Query(None),
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
                kind=kind,
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
    kind: PlaceRouteKind | None = Query(None),
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
                kind=kind,
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
    kind: PlaceRouteKind | None = Query(None),
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
                kind=kind,
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
    kind: PlaceRouteKind | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> PlaceProfileResponse:
    """Return place demographic and socioeconomic context."""
    service = _get_service(settings)
    try:
        apply_static_public_cache(response)
        return PlaceProfileResponse.model_validate(
            await service.get_place_profile(normalize_place_key(place_key), kind=kind)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
