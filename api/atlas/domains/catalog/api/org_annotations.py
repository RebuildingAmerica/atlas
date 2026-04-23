"""Org-scoped annotation endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.models import EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


# --- Request/Response schemas ---


class AnnotationCreateRequest(BaseModel):
    """Request to create an annotation."""

    entry_id: str = Field(..., description="ID of the shared entry to annotate")
    content: str = Field(..., description="Annotation content", min_length=1)


class AnnotationUpdateRequest(BaseModel):
    """Request to update an annotation."""

    content: str = Field(..., description="Updated annotation content", min_length=1)


class AnnotationResponse(BaseModel):
    """Annotation response model."""

    id: str = Field(..., description="Annotation ID")
    org_id: str = Field(..., description="Owning organization ID")
    entry_id: str = Field(..., description="Annotated entry ID")
    content: str = Field(..., description="Annotation content")
    author_id: str = Field(..., description="Author user ID")
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Last update timestamp")


# --- Dependencies ---


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(
            status_code=403,
            detail="Access denied: org_id mismatch",
        )


# --- Endpoints ---


@router.get(
    "",
    response_model=list[AnnotationResponse],
    summary="List annotations for org",
    operation_id="listOrgAnnotations",
    tags=["org-annotations"],
)
async def list_org_annotations(
    org_id: str,
    response: Response,
    entry_id: str | None = Query(None, description="Filter by entry ID"),
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[AnnotationResponse]:
    """List annotations for the org, optionally filtered by entry_id."""
    _verify_org_access(actor, org_id)

    annotations = await OwnershipCRUD.list_annotations(db, org_id, entry_id=entry_id)
    apply_no_store_headers(response)
    return [
        AnnotationResponse(
            id=a.id,
            org_id=a.org_id,
            entry_id=a.entry_id,
            content=a.content,
            author_id=a.author_id,
            created_at=a.created_at,
            updated_at=a.updated_at,
        )
        for a in annotations
    ]


@router.post(
    "",
    response_model=AnnotationResponse,
    status_code=201,
    summary="Create an annotation",
    operation_id="createOrgAnnotation",
    tags=["org-annotations"],
)
async def create_org_annotation(
    org_id: str,
    req: AnnotationCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("workspace.notes")),
) -> AnnotationResponse:
    """Create an annotation on a shared entry."""
    _verify_org_access(actor, org_id)

    # Validate that entry_id references a real entry
    entry = await EntryCRUD.get_by_id(db, req.entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    annotation = await OwnershipCRUD.create_annotation(
        db,
        org_id=org_id,
        entry_id=req.entry_id,
        content=req.content,
        author_id=actor.user_id,
    )

    apply_no_store_headers(response)
    return AnnotationResponse(
        id=annotation.id,
        org_id=annotation.org_id,
        entry_id=annotation.entry_id,
        content=annotation.content,
        author_id=annotation.author_id,
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )


@router.put(
    "/{annotation_id}",
    response_model=AnnotationResponse,
    summary="Update an annotation",
    operation_id="updateOrgAnnotation",
    tags=["org-annotations"],
)
async def update_org_annotation(  # noqa: PLR0913
    org_id: str,
    annotation_id: str,
    req: AnnotationUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> AnnotationResponse:
    """Update an annotation (author or org admin/owner only)."""
    _verify_org_access(actor, org_id)

    existing = await OwnershipCRUD.get_annotation(db, annotation_id)
    if existing is None or existing.org_id != org_id:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Only the author or an admin/owner can update
    is_author = existing.author_id == actor.user_id
    is_privileged = actor.org_role in ("admin", "owner")
    if not is_author and not is_privileged:
        raise HTTPException(
            status_code=403,
            detail="Only the author or an org admin/owner can update this annotation",
        )

    updated = await OwnershipCRUD.update_annotation(db, annotation_id, req.content)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update annotation")

    apply_no_store_headers(response)
    return AnnotationResponse(
        id=updated.id,
        org_id=updated.org_id,
        entry_id=updated.entry_id,
        content=updated.content,
        author_id=updated.author_id,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )


@router.delete(
    "/{annotation_id}",
    status_code=204,
    summary="Delete an annotation",
    operation_id="deleteOrgAnnotation",
    tags=["org-annotations"],
)
async def delete_org_annotation(
    org_id: str,
    annotation_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete an annotation (author or org admin/owner only)."""
    _verify_org_access(actor, org_id)

    existing = await OwnershipCRUD.get_annotation(db, annotation_id)
    if existing is None or existing.org_id != org_id:
        raise HTTPException(status_code=404, detail="Annotation not found")

    is_author = existing.author_id == actor.user_id
    is_privileged = actor.org_role in ("admin", "owner")
    if not is_author and not is_privileged:
        raise HTTPException(
            status_code=403,
            detail="Only the author or an org admin/owner can delete this annotation",
        )

    await OwnershipCRUD.delete_annotation(db, annotation_id)
    apply_no_store_headers(response)
