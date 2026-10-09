"""What the public may know about the service right now, such as whether sales are open."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import get_usage_db
from atlas.domains.access.models.platform_switches import PlatformSwitchCRUD

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter(tags=["access"])

__all__ = ["router"]

_SHORT_CACHE = "public, max-age=30"


class ServiceStatusResponse(BaseModel):
    """Service state the app reads before offering checkout."""

    checkout_open: bool = Field(
        description="False while the platform operator has paused sales with the checkout switch."
    )


@router.get(
    "/service-status",
    response_model=ServiceStatusResponse,
    operation_id="getServiceStatus",
    summary="Service status",
    description="Whether checkout is open. Changes within a minute of the operator's switch.",
)
async def get_service_status(
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
) -> ServiceStatusResponse:
    """Return whether checkout is open."""
    response.headers["Cache-Control"] = _SHORT_CACHE
    return ServiceStatusResponse(
        checkout_open=not await PlatformSwitchCRUD.is_engaged(conn, "checkout")
    )
