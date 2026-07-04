"""Org-scoped workspace watch digest endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watch_events import OrgChangeEventCRUD, WatchEventType
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]

WatchDigestResourceType = Literal["entry", "coverage_target"]


class WatchDigestEntry(BaseModel):
    """Actor context attached to a digest event."""

    id: str
    name: str
    slug: str | None
    type: str


class WatchDigestSource(BaseModel):
    """Source receipt attached to a digest event."""

    id: str
    url: str
    title: str | None
    publication: str | None
    published_date: str | None
    type: str


class WatchDigestItem(BaseModel):
    """One digest event for a watched workspace resource."""

    id: str
    resource_type: WatchDigestResourceType
    resource_id: str
    event_type: WatchEventType
    title: str
    summary: str
    created_at: str
    entry: WatchDigestEntry | None
    source: WatchDigestSource | None


class WatchDigestResponse(BaseModel):
    """Digest response for the current workspace."""

    items: list[WatchDigestItem]
    total: int
    source_signal_count: int
    coverage_signal_count: int


@dataclass(slots=True)
class WatchDigestContext:
    """Shared request dependencies for watch digest routes."""

    response: Response
    actor: AuthenticatedActor
    db: aiosqlite.Connection


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


async def get_watch_digest_context(
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("monitoring.watchlists")),
) -> WatchDigestContext:
    """Return shared digest route dependencies after auth and capability checks."""
    return WatchDigestContext(response=response, actor=actor, db=db)


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


def _digest_item(row: dict[str, object]) -> WatchDigestItem:
    """Convert a digest SQL row into a public response item."""
    entry = None
    if row["entry_id"] is not None:
        entry = WatchDigestEntry(
            id=str(row["entry_id"]),
            name=str(row["entry_name"]),
            slug=str(row["entry_slug"]) if row["entry_slug"] is not None else None,
            type=str(row["entry_type"]),
        )

    source = None
    if row["source_id"] is not None:
        source = WatchDigestSource(
            id=str(row["source_id"]),
            url=str(row["source_url"]),
            title=str(row["source_title"]) if row["source_title"] is not None else None,
            publication=str(row["source_publication"])
            if row["source_publication"] is not None
            else None,
            published_date=str(row["source_published_date"])
            if row["source_published_date"] is not None
            else None,
            type=str(row["source_type"]),
        )

    return WatchDigestItem(
        id=str(row["id"]),
        resource_type=cast("WatchDigestResourceType", row["resource_type"]),
        resource_id=str(row["resource_id"]),
        event_type=cast("WatchEventType", row["event_type"]),
        title=str(row["title"]),
        summary=str(row["summary"]),
        created_at=str(row["created_at"]),
        entry=entry,
        source=source,
    )


@router.get(
    "",
    response_model=WatchDigestResponse,
    summary="List workspace watch digest",
    operation_id="listOrgWatchDigest",
    tags=["org-watch-digest"],
)
async def list_org_watch_digest(
    org_id: str,
    limit: int = Query(50, ge=1, le=200),
    context: WatchDigestContext = Depends(get_watch_digest_context),
) -> WatchDigestResponse:
    """Return digest events for resources the workspace watches."""
    _verify_org_access(context.actor, org_id)
    rows = await OrgChangeEventCRUD.list_digest(context.db, org_id=org_id, limit=limit)
    items = [_digest_item(row) for row in rows]
    await OrgUsageEventCRUD.record(
        context.db,
        OrgUsageEventRecord(
            org_id=org_id,
            actor_id=context.actor.user_id,
            event_type="digest_viewed",
            resource_type="digest",
            resource_id=org_id,
        ),
    )
    apply_no_store_headers(context.response)
    return WatchDigestResponse(
        items=items,
        total=len(items),
        source_signal_count=sum(1 for item in items if item.event_type == "new_source"),
        coverage_signal_count=sum(
            1 for item in items if item.event_type == "coverage_status_changed"
        ),
    )
