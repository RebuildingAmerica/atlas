"""Mutating catalog entity endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Response

from atlas.domains.access.dependencies import require_org_actor_permission
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.models import EntryCRUD, FlagCRUD
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import EntityCreateRequest, EntityDetailResponse, EntityUpdateRequest

from .entries import router
from .entries_support import _entity_to_detail_response, get_db

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor


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
    """Create a new entry.

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
            VALUES (?, ?, CURRENT_TIMESTAMP)
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
