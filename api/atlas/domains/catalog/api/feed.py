"""Activity feed for followed profiles."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Query, Response

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.models.follows import FollowCRUD
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


@router.get(
    "/following",
    summary="Followed-profile activity feed",
    description=(
        "Return recent source ingest events for every profile the authenticated "
        "user follows, newest first."
    ),
    operation_id="getFollowingFeed",
    tags=["feed"],
)
async def following_feed(
    response: Response,
    limit: int = Query(50, ge=1, le=200),
    actor: AuthenticatedActor = Depends(require_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, list[dict[str, Any]]]:
    """Return the followed-profile feed for the current actor."""
    items = await FollowCRUD.feed_updates(db, actor.user_id, limit=limit)
    apply_no_store_headers(response)
    return {"items": items}
