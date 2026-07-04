"""Saved-list endpoints — signed-in users can pin profiles into named collections."""

from __future__ import annotations

import csv
import io
import logging
import re
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.models.saved_lists import SavedListCRUD, SavedListModel
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.catalog.schemas.public import (
    EntityResponse,
    SavedListCreateRequest,
    SavedListExportItemResponse,
    SavedListExportResponse,
    SavedListExportSource,
    SavedListItemRequest,
    SavedListItemResponse,
    SavedListResponse,
)
from atlas.models import EntryCRUD, FlagCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.platform.mcp.data import EntityRecordContext, _entity_record

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]

CSV_COLUMNS = [
    "list_id",
    "list_name",
    "entry_id",
    "name",
    "type",
    "location",
    "source_count",
    "trust_level",
    "source_urls",
    "note",
    "added_at",
    "profile_slug",
]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


async def _hydrate_entry_with_sources(
    db: aiosqlite.Connection,
    entry_id: str,
) -> tuple[EntityResponse | None, list[SavedListExportSource]]:
    """Build an entity response plus exportable source receipts."""
    entry, sources = await EntryCRUD.get_with_sources(db, entry_id)
    if entry is None:
        return None, []
    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    flag_summaries = await FlagCRUD.entity_flag_summaries(db, [entry_id])
    record = _entity_record(
        entry,
        EntityRecordContext(
            issue_area_ids=issue_areas,
            source_types=sorted({source["type"] for source in sources}),
            source_count=len(sources),
            latest_source_date=(
                next(
                    (
                        source["published_date"] or source["ingested_at"][:10]
                        for source in sources
                        if source.get("published_date") or source.get("ingested_at")
                    ),
                    None,
                )
            ),
            flag_summary=flag_summaries.get(entry_id),
        ),
    )
    source_receipts = [
        SavedListExportSource(
            id=str(source["id"]),
            url=str(source["url"]),
            title=source.get("title"),
            publication=source.get("publication"),
            type=source.get("type"),
        )
        for source in sources
    ]
    return EntityResponse.model_validate(record), source_receipts


async def _hydrate_entry(db: aiosqlite.Connection, entry_id: str) -> EntityResponse | None:
    """Build an EntityResponse for an entry id, or None if missing."""
    entry_response, _source_receipts = await _hydrate_entry_with_sources(db, entry_id)
    return entry_response


def _list_to_response(
    list_record: SavedListModel,
    *,
    item_count: int,
    items: list[SavedListItemResponse] | None = None,
) -> SavedListResponse:
    return SavedListResponse(
        id=list_record.id,
        user_id=list_record.user_id,
        name=list_record.name,
        description=list_record.description,
        item_count=item_count,
        items=items or [],
        created_at=list_record.created_at,
        updated_at=list_record.updated_at,
    )


async def _list_items_response(
    db: aiosqlite.Connection,
    list_id: str,
) -> list[SavedListItemResponse]:
    """Return saved-list items with compact hydrated actor records."""
    raw_items = await SavedListCRUD.list_items(db, list_id)
    items: list[SavedListItemResponse] = []
    for item in raw_items:
        entry_response = await _hydrate_entry(db, item.entry_id)
        items.append(
            SavedListItemResponse(
                list_id=item.list_id,
                entry_id=item.entry_id,
                note=item.note,
                added_at=item.added_at,
                entry=entry_response,
            )
        )
    return items


def _saved_list_export_response(
    list_record: SavedListModel,
    items: list[SavedListExportItemResponse],
) -> SavedListExportResponse:
    """Build the JSON export shape from a saved list and hydrated rows."""
    source_count = sum(len(item.sources) for item in items)
    list_items = [
        SavedListItemResponse(
            list_id=item.list_id,
            entry_id=item.entry_id,
            note=item.note,
            added_at=item.added_at,
            entry=item.entry,
        )
        for item in items
    ]
    list_response = _list_to_response(list_record, item_count=len(items), items=list_items)
    return SavedListExportResponse(
        list_=list_response,
        items=items,
        provenance={
            "item_count": len(items),
            "source_count": source_count,
        },
    )


def _csv_filename_segment(value: str) -> str:
    """Normalize a saved-list name into a stable filename segment."""
    segment = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return segment or "atlas-list"


def _saved_list_csv_filename(list_record: SavedListModel) -> str:
    """Build the download filename for a saved-list CSV export."""
    return f"{_csv_filename_segment(list_record.name)}-list-{list_record.id}.csv"


def _entry_location(entry: EntityResponse | None) -> str:
    """Return the user-visible actor location for export rows."""
    if entry is None:
        return ""
    if entry.address.display:
        return entry.address.display
    parts = [part for part in (entry.address.city, entry.address.state) if part]
    return ", ".join(parts)


async def _list_export_items_response(
    db: aiosqlite.Connection,
    list_id: str,
) -> list[SavedListExportItemResponse]:
    """Return saved-list export items with source receipts."""
    raw_items = await SavedListCRUD.list_items(db, list_id)
    items: list[SavedListExportItemResponse] = []
    for item in raw_items:
        entry_response, source_receipts = await _hydrate_entry_with_sources(db, item.entry_id)
        items.append(
            SavedListExportItemResponse(
                list_id=item.list_id,
                entry_id=item.entry_id,
                note=item.note,
                added_at=item.added_at,
                entry=entry_response,
                trust_level=entry_response.trust.level
                if entry_response is not None
                else "unverified",
                sources=source_receipts,
            )
        )
    return items


def _saved_list_export_csv(export: SavedListExportResponse) -> str:
    """Serialize a saved-list export as CSV research rows."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for item in export.items:
        entry = item.entry
        source_urls = ";".join(source.url for source in item.sources)
        writer.writerow(
            {
                "list_id": export.list_.id,
                "list_name": export.list_.name,
                "entry_id": item.entry_id,
                "name": entry.name if entry is not None else "Profile unavailable",
                "type": entry.type if entry is not None else "",
                "location": _entry_location(entry),
                "source_count": entry.source_count if entry is not None else 0,
                "trust_level": item.trust_level,
                "source_urls": source_urls,
                "note": item.note or "",
                "added_at": item.added_at,
                "profile_slug": entry.slug if entry is not None and entry.slug else "",
            }
        )
    return buffer.getvalue()


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
