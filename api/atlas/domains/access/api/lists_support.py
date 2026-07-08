"""Support helpers for saved-list endpoints."""

from __future__ import annotations

import csv
import io
import re
from typing import TYPE_CHECKING

from fastapi import Depends

from atlas.domains.access.models.saved_lists import SavedListCRUD, SavedListModel
from atlas.domains.catalog.schemas.public import (
    EntityResponse,
    SavedListExportItemResponse,
    SavedListExportResponse,
    SavedListExportSource,
    SavedListItemResponse,
    SavedListResponse,
)
from atlas.models import EntryCRUD, FlagCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.mcp.data import EntityRecordContext, _entity_record

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    import aiosqlite

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
