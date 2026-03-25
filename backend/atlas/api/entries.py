"""Entry endpoints."""

import logging
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query

from atlas.config import Settings, get_settings
from atlas.models import EntryCRUD, get_db_connection
from atlas.schemas import EntryCreateRequest, EntryResponse, EntryUpdateRequest
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


@router.get("", response_model=list[EntryResponse])
async def list_entries(  # noqa: PLR0913
    state: str | None = Query(None, min_length=2, max_length=2),
    city: str | None = Query(None),
    entry_type: str | None = Query(None),
    issue_area: str | None = Query(None),
    search: str | None = Query(None),
    active_only: bool = Query(True),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncGenerator = Depends(get_db),
) -> list[EntryResponse]:
    """
    List entries with filtering and search.

    Query Parameters:
    - state: 2-letter state code
    - city: city name
    - entry_type: person, organization, initiative, campaign, event
    - issue_area: issue area slug
    - search: full-text search query
    - active_only: only active entries (default: true)
    - limit: results per page (default: 100, max: 1000)
    - offset: pagination offset (default: 0)
    """
    if issue_area:
        if issue_area not in ALL_ISSUE_SLUGS:
            raise HTTPException(status_code=400, detail=f"Invalid issue area: {issue_area}")
        entries = await EntryCRUD.filter_by_issue_area(
            db,
            issue_area,
            state=state,
            limit=limit,
            offset=offset,
        )
    elif search:
        entries = await EntryCRUD.search_fts(db, search, limit=limit)
    else:
        entries = await EntryCRUD.list(
            db,
            state=state,
            city=city,
            entry_type=entry_type,
            active_only=active_only,
            limit=limit,
            offset=offset,
        )

    return [_entry_to_response(e) for e in entries]


@router.get("/{entry_id}", response_model=EntryResponse)
async def get_entry(
    entry_id: str,
    db: AsyncGenerator = Depends(get_db),
) -> EntryResponse:
    """Get a single entry by ID."""
    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return _entry_to_response(entry)


@router.post("", response_model=EntryResponse, status_code=201)
async def create_entry(
    req: EntryCreateRequest,
    db: AsyncGenerator = Depends(get_db),
) -> EntryResponse:
    """
    Create a new entry.

    Validates issue areas against the taxonomy.
    """
    # Validate issue areas
    for issue_area in req.issue_areas:
        if issue_area not in ALL_ISSUE_SLUGS:
            raise HTTPException(status_code=400, detail=f"Invalid issue area: {issue_area}")

    entry_id = await EntryCRUD.create(
        db,
        entry_type=req.type,
        name=req.name,
        description=req.description,
        city=req.city,
        state=req.state,
        geo_specificity=req.geo_specificity,
        region=req.region,
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

    # Link issue areas
    for issue_area in req.issue_areas:
        await db.execute(
            """
            INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
            VALUES (?, ?, datetime('now'))
            """,
            (entry_id, issue_area),
        )
    await db.commit()

    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=500, detail="Failed to create entry")

    return _entry_to_response(entry)


@router.patch("/{entry_id}", response_model=EntryResponse)
async def update_entry(
    entry_id: str,
    req: EntryUpdateRequest,
    db: AsyncGenerator = Depends(get_db),
) -> EntryResponse:
    """Update an entry (partial update)."""
    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Build update dict from request
    update_dict = {
        field: value
        for field, value in req.model_dump(exclude_unset=True).items()
        if value is not None
    }

    if update_dict:
        await EntryCRUD.update(db, entry_id, **update_dict)

    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=500, detail="Failed to update entry")

    return _entry_to_response(entry)


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: str,
    db: AsyncGenerator = Depends(get_db),
) -> None:
    """Delete an entry."""
    success = await EntryCRUD.delete(db, entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Entry not found")


def _entry_to_response(entry: any) -> EntryResponse:
    """Convert EntryModel to EntryResponse with issue areas."""
    # Placeholder - would fetch issue areas from DB
    return EntryResponse(
        id=entry.id,
        type=entry.type,
        name=entry.name,
        description=entry.description,
        city=entry.city,
        state=entry.state,
        region=entry.region,
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
        contact_status=entry.contact_status,
        editorial_notes=entry.editorial_notes,
        priority=entry.priority,
        issue_areas=[],  # Would be populated from DB
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )
