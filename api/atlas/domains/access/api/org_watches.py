"""Org-scoped workspace watch endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watches import (
    OrgWatchCRUD,
    OrgWatchModel,
    OrgWatchUpsert,
    WatchNotificationPreference,
    WatchResourceType,
)
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.models import EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]


class OrgWatchRequest(BaseModel):
    """Request body for creating or updating a workspace watch."""

    notification_preference: WatchNotificationPreference = "digest"


class OrgWatchResponse(BaseModel):
    """Workspace watch resource."""

    id: str
    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    notification_preference: WatchNotificationPreference
    created_by: str
    created_at: str
    updated_at: str


class OrgWatchStatusResponse(BaseModel):
    """Watch status for one resource."""

    watched: bool
    watch: OrgWatchResponse | None


class OrgWatchCollectionResponse(BaseModel):
    """Collection response for workspace watches."""

    items: list[OrgWatchResponse]
    total: int


@dataclass(slots=True)
class WatchRequestContext:
    """Shared request dependencies for workspace watch routes."""

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


async def get_watch_context(
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("monitoring.watchlists")),
) -> WatchRequestContext:
    """Return shared watch route dependencies after auth and capability checks."""
    return WatchRequestContext(response=response, actor=actor, db=db)


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


def _watch_response(watch: OrgWatchModel) -> OrgWatchResponse:
    """Convert a watch model into an API response."""
    return OrgWatchResponse(
        id=watch.id,
        org_id=watch.org_id,
        resource_type=watch.resource_type,
        resource_id=watch.resource_id,
        notification_preference=watch.notification_preference,
        created_by=watch.created_by,
        created_at=watch.created_at,
        updated_at=watch.updated_at,
    )


async def _verify_watchable_resource(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    resource_type: WatchResourceType,
    resource_id: str,
) -> None:
    """Validate that a watch target exists and belongs to the workspace when private."""
    if resource_type == "entry":
        if await EntryCRUD.get_by_id(db, resource_id) is None:
            raise HTTPException(status_code=404, detail="Watch target not found")
        return

    target = await CoverageTargetCRUD.get(db, resource_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(status_code=404, detail="Watch target not found")


@router.get(
    "",
    response_model=OrgWatchCollectionResponse,
    summary="List workspace watches",
    operation_id="listOrgWatches",
    tags=["org-watches"],
)
async def list_org_watches(
    org_id: str,
    context: WatchRequestContext = Depends(get_watch_context),
) -> OrgWatchCollectionResponse:
    """List watch subscriptions for one workspace."""
    _verify_org_access(context.actor, org_id)
    watches = await OrgWatchCRUD.list_by_org(context.db, org_id)
    apply_no_store_headers(context.response)
    return OrgWatchCollectionResponse(
        items=[_watch_response(watch) for watch in watches],
        total=len(watches),
    )


@router.get(
    "/{resource_type}/{resource_id}",
    response_model=OrgWatchStatusResponse,
    summary="Get workspace watch status",
    operation_id="getOrgWatchStatus",
    tags=["org-watches"],
)
async def get_org_watch_status(
    org_id: str,
    resource_type: WatchResourceType,
    resource_id: str,
    context: WatchRequestContext = Depends(get_watch_context),
) -> OrgWatchStatusResponse:
    """Return whether the workspace watches one resource."""
    _verify_org_access(context.actor, org_id)
    await _verify_watchable_resource(
        context.db,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    watch = await OrgWatchCRUD.get(
        context.db,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    apply_no_store_headers(context.response)
    return OrgWatchStatusResponse(
        watched=watch is not None,
        watch=_watch_response(watch) if watch is not None else None,
    )


@router.put(
    "/{resource_type}/{resource_id}",
    response_model=OrgWatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Watch a workspace resource",
    operation_id="watchOrgResource",
    tags=["org-watches"],
)
async def watch_org_resource(
    org_id: str,
    resource_type: WatchResourceType,
    resource_id: str,
    payload: OrgWatchRequest | None = None,
    context: WatchRequestContext = Depends(get_watch_context),
) -> OrgWatchResponse:
    """Create or update a workspace watch."""
    _verify_org_access(context.actor, org_id)
    await _verify_watchable_resource(
        context.db,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    existing = await OrgWatchCRUD.get(
        context.db,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    watch = await OrgWatchCRUD.upsert(
        context.db,
        OrgWatchUpsert(
            org_id=org_id,
            resource_type=resource_type,
            resource_id=resource_id,
            created_by=context.actor.user_id,
            notification_preference=payload.notification_preference if payload else "digest",
        ),
    )
    if existing is None:
        await OrgUsageEventCRUD.record(
            context.db,
            OrgUsageEventRecord(
                org_id=org_id,
                actor_id=context.actor.user_id,
                event_type="watch_created",
                resource_type="watch",
                resource_id=watch.id,
            ),
        )
    apply_no_store_headers(context.response)
    return _watch_response(watch)


@router.delete(
    "/{resource_type}/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unwatch a workspace resource",
    operation_id="unwatchOrgResource",
    tags=["org-watches"],
)
async def unwatch_org_resource(
    org_id: str,
    resource_type: WatchResourceType,
    resource_id: str,
    context: WatchRequestContext = Depends(get_watch_context),
) -> Response:
    """Remove a workspace watch."""
    _verify_org_access(context.actor, org_id)
    await _verify_watchable_resource(
        context.db,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    await OrgWatchCRUD.delete(
        context.db,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    apply_no_store_headers(context.response)
    context.response.status_code = status.HTTP_204_NO_CONTENT
    return context.response
