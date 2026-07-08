"""Saved-list endpoints — signed-in users can pin profiles into named collections."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.catalog.schemas.public import (
    SavedListCreateRequest,
    SavedListExportResponse,
    SavedListItemRequest,
    SavedListItemResponse,
    SavedListResponse,
)
from atlas.models import EntryCRUD
from atlas.platform.http.cache import apply_no_store_headers

from .lists_support import (
    _entry_location,  # noqa: F401
    _hydrate_entry,
    _list_export_items_response,
    _list_items_response,
    _list_to_response,
    _saved_list_csv_filename,
    _saved_list_export_csv,
    _saved_list_export_response,
    get_db,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]


@router.post(
    "",
    response_model=SavedListResponse,
    summary="Create a saved list",
    operation_id="createSavedList",
    status_code=status.HTTP_201_CREATED,
    tags=["lists"],
)
async def create_list(
    payload: SavedListCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> SavedListResponse:
    """Create a saved list owned by the current user."""
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="List name is required.")
    record = await SavedListCRUD.create(
        db, user_id=actor.user_id, name=payload.name.strip(), description=payload.description
    )
    apply_no_store_headers(response)
    return _list_to_response(record, item_count=0, items=[])


@router.get(
    "",
    response_model=list[SavedListResponse],
    summary="List my saved lists",
    operation_id="listSavedLists",
    tags=["lists"],
)
async def list_my_lists(
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[SavedListResponse]:
    """Return all lists the current user owns."""
    records = await SavedListCRUD.list_for_user(db, actor.user_id)
    apply_no_store_headers(response)
    out: list[SavedListResponse] = []
    for record in records:
        count = await SavedListCRUD.count_items(db, record.id)
        out.append(_list_to_response(record, item_count=count))
    return out


@router.get(
    "/{list_id}",
    response_model=SavedListResponse,
    summary="Get a saved list",
    operation_id="getSavedList",
    tags=["lists"],
)
async def get_list(
    list_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> SavedListResponse:
    """Return a saved list with hydrated entries."""
    record = await SavedListCRUD.get_by_id(db, list_id)
    if record is None or record.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="List not found.")
    items = await _list_items_response(db, list_id)
    apply_no_store_headers(response)
    return _list_to_response(record, item_count=len(items), items=items)


@router.get(
    "/{list_id}/export",
    response_model=SavedListExportResponse,
    summary="Export a saved list",
    operation_id="exportSavedList",
    tags=["lists"],
)
async def export_list(
    list_id: str,
    response: Response,
    export_format: Literal["json", "csv"] = Query("json", alias="format"),
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> SavedListExportResponse | Response:
    """Export one saved list with notes and compact source-count provenance."""
    record = await SavedListCRUD.get_by_id(db, list_id)
    if record is None or record.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="List not found.")
    items = await _list_export_items_response(db, list_id)
    export = _saved_list_export_response(record, items)
    if export_format == "csv":
        csv_response = Response(
            content=_saved_list_export_csv(export),
            media_type="text/csv; charset=utf-8",
        )
        csv_response.headers["content-disposition"] = (
            f'attachment; filename="{_saved_list_csv_filename(record)}"'
        )
        apply_no_store_headers(csv_response)
        return csv_response

    apply_no_store_headers(response)
    return export


@router.delete(
    "/{list_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a saved list",
    operation_id="deleteSavedList",
    tags=["lists"],
)
async def delete_list(
    list_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> Response:
    """Delete a saved list and (cascade) its items."""
    record = await SavedListCRUD.get_by_id(db, list_id)
    if record is None or record.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="List not found.")
    await SavedListCRUD.delete(db, list_id)
    apply_no_store_headers(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post(
    "/{list_id}/items",
    response_model=SavedListItemResponse,
    summary="Add an entry to a saved list",
    operation_id="addSavedListItem",
    status_code=status.HTTP_201_CREATED,
    tags=["lists"],
)
async def add_item(
    list_id: str,
    payload: SavedListItemRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> SavedListItemResponse:
    """Add an entry to a saved list."""
    record = await SavedListCRUD.get_by_id(db, list_id)
    if record is None or record.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="List not found.")
    entry = await EntryCRUD.get_by_id(db, payload.entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    item = await SavedListCRUD.add_item(
        db, list_id=list_id, entry_id=payload.entry_id, note=payload.note
    )
    if actor.org_id is not None:
        await OrgUsageEventCRUD.record(
            db,
            OrgUsageEventRecord(
                org_id=actor.org_id,
                actor_id=actor.user_id,
                event_type="list_item_saved",
                resource_type="saved_list",
                resource_id=list_id,
            ),
        )
    entry_response = await _hydrate_entry(db, payload.entry_id)
    apply_no_store_headers(response)
    return SavedListItemResponse(
        list_id=item.list_id,
        entry_id=item.entry_id,
        note=item.note,
        added_at=item.added_at,
        entry=entry_response,
    )


@router.delete(
    "/{list_id}/items/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an entry from a saved list",
    operation_id="removeSavedListItem",
    tags=["lists"],
)
async def remove_item(
    list_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> Response:
    """Remove an entry from a saved list."""
    record = await SavedListCRUD.get_by_id(db, list_id)
    if record is None or record.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="List not found.")
    removed = await SavedListCRUD.remove_item(db, list_id=list_id, entry_id=entry_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Item not found in list.")
    apply_no_store_headers(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get(
    "/membership/{entry_id}",
    response_model=list[str],
    summary="List my list-memberships for an entry",
    description="Return ids of all of my lists that already contain this entry.",
    operation_id="getSavedListMembership",
    tags=["lists"],
)
async def membership(
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[str]:
    """Return list ids that contain ``entry_id`` for the current user."""
    apply_no_store_headers(response)
    return await SavedListCRUD.lists_containing_entry(db, user_id=actor.user_id, entry_id=entry_id)
