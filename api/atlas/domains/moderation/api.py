"""Anonymous public flag endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from atlas.models import EntryCRUD, FlagCRUD, SourceCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import (
    EntityFlagCreateRequest,
    EntityFlagListResponse,
    FlagResponse,
    SourceFlagCreateRequest,
    SourceFlagListResponse,
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


@router.post(
    "/entity-flags",
    response_model=FlagResponse,
    status_code=201,
    summary="Create an entity flag",
    description="Submit an anonymous flag for an Atlas entity that looks stale or incorrect.",
    operation_id="createEntityFlag",
    response_description="The newly created entity flag.",
    tags=["flags"],
)
async def create_entity_flag(
    req: EntityFlagCreateRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Create an anonymous entity flag."""
    if await EntryCRUD.get_by_id(db, req.entity_id) is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    flag = await FlagCRUD.create_entity_flag(
        db, entity_id=req.entity_id, reason=req.reason, note=req.note
    )
    apply_no_store_headers(response)
    return FlagResponse.model_validate(flag.__dict__)


@router.get(
    "/entity-flags",
    response_model=EntityFlagListResponse,
    summary="List entity flags",
    description="List anonymous flags that have been submitted for one Atlas entity.",
    operation_id="listEntityFlags",
    response_description="A paginated collection of entity flags.",
    tags=["flags"],
)
async def list_entity_flags(
    response: Response,
    entity_id: str = Query(...),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityFlagListResponse:
    """List flags for one entity."""
    offset = max(int(cursor), 0) if cursor is not None else 0
    items = [
        FlagResponse.model_validate(flag.__dict__)
        for flag in await FlagCRUD.list_entity_flags(
            db, entity_id=entity_id, limit=limit, offset=offset
        )
    ]
    total = await FlagCRUD.count_entity_flags(db, entity_id=entity_id)
    next_cursor = str(offset + limit) if offset + limit < total else None
    apply_no_store_headers(response)
    return EntityFlagListResponse(items=items, total=total, next_cursor=next_cursor)


@router.post(
    "/source-flags",
    response_model=FlagResponse,
    status_code=201,
    summary="Create a source flag",
    description="Submit an anonymous flag for an Atlas source record that looks stale or incorrect.",
    operation_id="createSourceFlag",
    response_description="The newly created source flag.",
    tags=["flags"],
)
async def create_source_flag(
    req: SourceFlagCreateRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> FlagResponse:
    """Create an anonymous source flag."""
    if await SourceCRUD.get_by_id(db, req.source_id) is None:
        raise HTTPException(status_code=404, detail="Source not found")
    flag = await FlagCRUD.create_source_flag(
        db, source_id=req.source_id, reason=req.reason, note=req.note
    )
    apply_no_store_headers(response)
    return FlagResponse.model_validate(flag.__dict__)


@router.get(
    "/source-flags",
    response_model=SourceFlagListResponse,
    summary="List source flags",
    description="List anonymous flags that have been submitted for one Atlas source.",
    operation_id="listSourceFlags",
    response_description="A paginated collection of source flags.",
    tags=["flags"],
)
async def list_source_flags(
    response: Response,
    source_id: str = Query(...),
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> SourceFlagListResponse:
    """List flags for one source."""
    offset = max(int(cursor), 0) if cursor is not None else 0
    items = [
        FlagResponse.model_validate(flag.__dict__)
        for flag in await FlagCRUD.list_source_flags(
            db, source_id=source_id, limit=limit, offset=offset
        )
    ]
    total = await FlagCRUD.count_source_flags(db, source_id=source_id)
    next_cursor = str(offset + limit) if offset + limit < total else None
    apply_no_store_headers(response)
    return SourceFlagListResponse(items=items, total=total, next_cursor=next_cursor)
