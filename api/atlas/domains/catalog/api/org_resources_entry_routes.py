"""Private entry CRUD endpoints for org-scoped resources."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.principals import AuthenticatedActor  # noqa: TC001
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import EntityCreateRequest, EntityDetailResponse, EntityUpdateRequest

from .org_resources_models import HeldPublishResponse, PublishEntryResponse
from .org_resources_support import (
    _entry_to_detail_response,
    _source_count_for_entry,
    _verify_org_access,
    get_db,
)

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter()

__all__ = [
    "create_org_entry",
    "delete_org_entry",
    "get_org_entry",
    "list_org_entries",
    "publish_org_entry",
    "router",
    "update_org_entry",
]


@router.get(
    "",
    response_model=list[EntityDetailResponse],
    summary="List private entries for org",
    operation_id="listOrgEntries",
    tags=["org-entries"],
)
async def list_org_entries(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[EntityDetailResponse]:
    """List private entries owned by the org."""
    _verify_org_access(actor, org_id)

    ownership_records = await OwnershipCRUD.list_by_org(
        db, org_id, resource_type="entry", visibility="private"
    )
    entries: list[EntityDetailResponse] = []
    for record in ownership_records:
        entry = await EntryCRUD.get_by_id(db, record.resource_id)
        if entry is not None:
            issue_areas = await EntryCRUD.get_issue_areas(db, entry.id)
            entries.append(await _entry_to_detail_response(entry, issue_areas))

    apply_no_store_headers(response)
    return entries


@router.post(
    "",
    response_model=EntityDetailResponse,
    status_code=201,
    summary="Create a private entry for org",
    operation_id="createOrgEntry",
    tags=["org-entries"],
)
async def create_org_entry(
    org_id: str,
    req: EntityCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Create a private entry owned by the org."""
    _verify_org_access(actor, org_id)

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

    await OwnershipCRUD.create_ownership(
        db,
        resource_id=entity_id,
        resource_type="entry",
        org_id=org_id,
        visibility="private",
        created_by=actor.user_id,
    )

    entry = await EntryCRUD.get_by_id(db, entity_id)
    assert entry is not None, "EntryCRUD.create just returned this id; row must exist"

    apply_no_store_headers(response)
    return await _entry_to_detail_response(entry, req.issue_areas)


@router.get(
    "/{entry_id}",
    response_model=EntityDetailResponse,
    summary="Get a private entry",
    operation_id="getOrgEntry",
    tags=["org-entries"],
)
async def get_org_entry(
    org_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Get a single private entry owned by the org."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    apply_no_store_headers(response)
    return await _entry_to_detail_response(entry, issue_areas)


@router.put(
    "/{entry_id}",
    response_model=EntityDetailResponse,
    summary="Update a private entry",
    operation_id="updateOrgEntry",
    tags=["org-entries"],
)
async def update_org_entry(  # noqa: PLR0913
    org_id: str,
    entry_id: str,
    req: EntityUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Update a private entry owned by the org."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

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

    updated_entry = await EntryCRUD.get_by_id(db, entry_id)
    assert updated_entry is not None, "entry existed under this org_id moments ago"

    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    apply_no_store_headers(response)
    return await _entry_to_detail_response(updated_entry, issue_areas)


@router.put(
    "/{entry_id}/publish",
    response_model=PublishEntryResponse,
    summary="Publish a workspace entry",
    operation_id="publishOrgEntry",
    tags=["org-entries"],
)
async def publish_org_entry(
    org_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("public.directories")),
) -> PublishEntryResponse:
    """Publish a workspace-owned entry into that workspace's public directory."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    should_record_public_improvement = ownership.visibility != "public"

    if await _source_count_for_entry(db, entry_id) == 0:
        review_item_id = await ReviewQueueCRUD.enqueue(
            db,
            org_id=org_id,
            entity_id=entry_id,
            kind="tenant_publish",
            hold_reason="source_required_for_public_directory",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
        )
        detail = HeldPublishResponse(
            entry_id=entry_id,
            hold_reason="source_required_for_public_directory",
            review_item_id=review_item_id,
        )
        raise HTTPException(status_code=409, detail=detail.model_dump())

    updated = await OwnershipCRUD.update_visibility(
        db,
        resource_id=entry_id,
        resource_type="entry",
        visibility="public",
    )
    assert updated is not None, "ownership existed moments before the visibility update"
    if should_record_public_improvement:
        await OrgUsageEventCRUD.record(
            db,
            OrgUsageEventRecord(
                org_id=org_id,
                actor_id=actor.user_id,
                event_type="public_record_improved",
                resource_type="public_record",
                resource_id=entry_id,
            ),
        )
    apply_no_store_headers(response)
    return PublishEntryResponse(entry_id=entry_id, visibility=updated.visibility)


@router.delete(
    "/{entry_id}",
    status_code=204,
    summary="Delete a private entry",
    operation_id="deleteOrgEntry",
    tags=["org-entries"],
)
async def delete_org_entry(
    org_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete a private entry and its ownership record."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    await EntryCRUD.delete(db, entry_id)
    await OwnershipCRUD.delete_ownership(db, entry_id, "entry")
    apply_no_store_headers(response)
