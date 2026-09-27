"""Mutating catalog entity endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Response
from fastapi.responses import JSONResponse

from atlas.domains.access.dependencies import require_org_actor_permission
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.models import EntryCRUD, FlagCRUD
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import EntityCreateRequest, EntityDetailResponse, EntityUpdateRequest

from .entries import router
from .entries_review import StagedEntityUpdateResponse, prepare_owned_entry_update
from .entries_support import _entity_to_detail_response, get_db

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor


@router.post(
    "",
    response_model=EntityDetailResponse,
    status_code=201,
    summary="Create an entity",
    description=(
        "Create a private workspace entity using the canonical nested address and contact "
        "request shape. Publish separately after adding a source."
    ),
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
    """Create a private workspace entry.

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
        visibility="private",
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
    description="Update a private entity or submit public fact changes for editorial review.",
    operation_id="updateEntity",
    response_description="The updated Atlas entity.",
    responses={202: {"model": StagedEntityUpdateResponse}},
    tags=["entities"],
)
async def update_entity(
    entity_id: str,
    req: EntityUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor_permission("entities", "write")),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse | JSONResponse:
    """Update a private entry immediately, or stage public facts for review."""
    entry = await EntryCRUD.get_by_id(db, entity_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entity not found")

    ownership = await OwnershipCRUD.get_ownership(db, entity_id, "entry")
    if ownership is None or ownership.org_id != actor.org_id:
        raise HTTPException(
            status_code=403, detail="Only the owning organization can modify this entity"
        )

    prepared = await prepare_owned_entry_update(db, entry=entry, ownership=ownership, request=req)
    if isinstance(prepared, JSONResponse):
        return prepared

    if prepared:
        await EntryCRUD.update(db, entity_id, **prepared)

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
    if ownership is None or ownership.org_id != actor.org_id:
        raise HTTPException(
            status_code=403, detail="Only the owning organization can delete this entity"
        )

    if ownership.visibility == "public":
        raise HTTPException(
            status_code=409,
            detail="Published entries require editorial removal; no public record was deleted.",
        )

    await EntryCRUD.delete(db, entity_id)
    await OwnershipCRUD.delete_ownership(db, entity_id, "entry")
    apply_no_store_headers(response)
