"""Shared review boundary for owner edits to public catalog entries."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from atlas.domains.moderation.review_queue import STAGED_ENTRY_FIELDS, ReviewQueueCRUD
from atlas.models import EntryCRUD
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.catalog.models.ownership import OwnershipModel
    from atlas.domains.catalog.schemas.entry import EntityUpdateRequest
    from atlas.models import EntryModel


class StagedEntityUpdateResponse(BaseModel):
    """An owner's proposed change, which has not changed the public profile."""

    entity_id: str
    review_item_id: str
    status: Literal["pending_review"] = "pending_review"
    message: str = (
        "Proposed public profile changes are awaiting editorial review. "
        "The published profile is unchanged."
    )


async def prepare_owned_entry_update(
    conn: aiosqlite.Connection,
    *,
    entry: EntryModel,
    ownership: OwnershipModel,
    request: EntityUpdateRequest,
) -> dict[str, Any] | JSONResponse:
    """Apply the right boundary before either owner-write endpoint mutates an entry."""
    update_fields = {
        field: value
        for field, value in request.model_dump(exclude_unset=True).items()
        if value is not None and field not in {"address", "contact"}
    }
    if {"active", "verified"} & update_fields.keys():
        raise HTTPException(
            status_code=403,
            detail="Publication and identity verification status require editorial review.",
        )

    if ownership.visibility != "public":
        return update_fields

    proposed_changes = {
        field: {"before": getattr(entry, field), "after": value}
        for field, value in update_fields.items()
        if field in STAGED_ENTRY_FIELDS and getattr(entry, field) != value
    }
    if not proposed_changes:
        return update_fields

    if set(update_fields) - STAGED_ENTRY_FIELDS:
        raise HTTPException(
            status_code=422,
            detail="Submit public profile facts separately from private workspace fields.",
        )
    if not entry.active:
        raise HTTPException(status_code=409, detail="This profile is not currently published.")
    if await ReviewQueueCRUD.has_pending_published_change(conn, entity_id=entry.id):
        raise HTTPException(
            status_code=409,
            detail="A public profile change is already awaiting review. No new changes were saved.",
        )

    _, sources = await EntryCRUD.get_with_sources(conn, entry.id)
    review_item_id = await ReviewQueueCRUD.stage_published_change(
        conn,
        org_id=ownership.org_id,
        entity_id=entry.id,
        kind=entry.type,
        proposed_changes=proposed_changes,
        source_urls=[source["url"] for source in sources],
    )
    result = JSONResponse(
        status_code=202,
        content=StagedEntityUpdateResponse(
            entity_id=entry.id, review_item_id=review_item_id
        ).model_dump(),
    )
    apply_no_store_headers(result)
    return result
