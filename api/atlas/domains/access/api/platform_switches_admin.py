"""The platform admin's switches: stop discovery spend or pause sales without a release."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import get_usage_db
from atlas.domains.access.models.platform_switches import (
    PlatformSwitch,
    PlatformSwitchCRUD,
    SwitchName,
)
from atlas.platform.authz import Action, PlatformOperator, require_platform_action
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter(tags=["platform"])

__all__ = ["router"]


class PlatformSwitchResponse(BaseModel):
    """One switch and its last change."""

    name: SwitchName = Field(description="discovery_spend or checkout")
    engaged: bool = Field(description="Whether the switch is engaged")
    reason: str | None = Field(None, description="Why it last changed; null if never flipped")
    changed_by: str | None = Field(None, description="Who last changed it")
    changed_at: str | None = Field(None, description="When it last changed")


class PlatformSwitchCollectionResponse(BaseModel):
    """Every platform switch."""

    items: list[PlatformSwitchResponse]


class PlatformSwitchUpdateRequest(BaseModel):
    """The new state of a switch, and why."""

    engaged: bool
    reason: str = Field(..., min_length=3, max_length=1000)


def _response(switch: PlatformSwitch) -> PlatformSwitchResponse:
    return PlatformSwitchResponse.model_validate(switch, from_attributes=True)


@router.get(
    "/api/platform/switches",
    response_model=PlatformSwitchCollectionResponse,
    operation_id="listPlatformSwitches",
    summary="List platform switches",
    description="Return every switch, its state, and who last changed it and why.",
)
async def list_platform_switches(
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    _operator: PlatformOperator = Depends(require_platform_action(Action.SWITCHES_READ)),
) -> PlatformSwitchCollectionResponse:
    """Return every platform switch."""
    apply_no_store_headers(response)
    return PlatformSwitchCollectionResponse(
        items=[_response(switch) for switch in await PlatformSwitchCRUD.list_all(conn)]
    )


@router.put(
    "/api/platform/switches/{name}",
    response_model=PlatformSwitchResponse,
    operation_id="setPlatformSwitch",
    summary="Engage or release a platform switch",
    description=(
        "Engage or release one switch. discovery_spend stops every discovery run from "
        "spending; checkout stops the pricing page from selling. Takes effect within a minute."
    ),
)
async def set_platform_switch(
    name: SwitchName,
    request: PlatformSwitchUpdateRequest,
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    operator: PlatformOperator = Depends(require_platform_action(Action.SWITCHES_WRITE)),
) -> PlatformSwitchResponse:
    """Engage or release one switch."""
    apply_no_store_headers(response)
    switch = await PlatformSwitchCRUD.set(
        conn,
        name,
        engaged=request.engaged,
        reason=request.reason.strip(),
        changed_by=operator.email,
    )
    return _response(switch)
