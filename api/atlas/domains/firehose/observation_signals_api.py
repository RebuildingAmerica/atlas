"""Internal REST API for creating signals from Firehose observations."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

from atlas.domains.access.internal import build_local_actor, verify_internal_actor
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings

from .bus import INVALID_OBSERVATION_DELIVERY_MESSAGE, parse_observation_delivery
from .signal_materializer import UNKNOWN_OBSERVATION_MESSAGE, create_signals_for_observation

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

router = APIRouter()


class FirehoseObservationSignalsResponse(BaseModel):
    """Result of creating signal resources for one Firehose observation."""

    observation_id: str = Field(
        ...,
        description="Stored Firehose observation used as the canonical evidence input.",
    )
    routes_created: int = Field(
        ...,
        ge=0,
        description="Number of workspace or public route records created for the observation.",
    )
    signals_created: int = Field(
        ...,
        ge=0,
        description="Number of signal records created from the observation.",
    )
    unchanged: bool = Field(
        ...,
        description="Whether all requested signal and route resources already existed.",
    )


async def get_internal_firehose_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[Any, None]:
    """Yield a per-request Firehose database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def require_internal_firehose_request(
    settings: Settings = Depends(get_settings),
    x_atlas_internal_secret: str | None = Header(None),
    x_atlas_actor_id: str | None = Header(None),
    x_atlas_actor_email: str | None = Header(None),
    x_atlas_organization_id: str | None = Header(None),
) -> None:
    """Allow local mode or trusted internal callers to create observation signals."""
    if not settings.multi_user:
        _ = build_local_actor()
        return

    actor = verify_internal_actor(
        settings,
        x_atlas_internal_secret,
        x_atlas_actor_id,
        x_atlas_actor_email,
        x_atlas_organization_id,
    )
    if actor is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Trusted Firehose internal access is required.",
        )


@router.post(
    "/internal/firehose/observations/{observation_id}/signals",
    response_model=FirehoseObservationSignalsResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Firehose signals for an observation",
    description=(
        "Create idempotent Firehose signal resources for one stored observation. This internal "
        "endpoint is used after a producer has written the observation row; it preserves the "
        "observation as the source of truth and only creates or reuses signal and route records."
    ),
    operation_id="createFirehoseObservationSignals",
    tags=["firehose-internal"],
)
async def create_observation_signals(
    observation_id: str,
    response: Response,
    _internal: None = Depends(require_internal_firehose_request),
    db: Any = Depends(get_internal_firehose_db),
) -> FirehoseObservationSignalsResponse:
    """Create user-facing signal resources for one stored observation."""
    try:
        result = await create_signals_for_observation(db, observation_id=observation_id)
    except ValueError as exc:
        if str(exc) == UNKNOWN_OBSERVATION_MESSAGE:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=UNKNOWN_OBSERVATION_MESSAGE,
            ) from exc
        raise

    if result.unchanged:
        response.status_code = status.HTTP_200_OK

    return FirehoseObservationSignalsResponse(
        observation_id=result.observation_id,
        routes_created=result.routes_created,
        signals_created=result.signals_created,
        unchanged=result.unchanged,
    )


@router.post(
    "/internal/firehose/observation-deliveries",
    response_model=FirehoseObservationSignalsResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Firehose observation delivery",
    description=(
        "Accept one message-bus delivery for a stored Firehose observation and create signal "
        "resources from the delivered observation id. The delivery payload contains only the "
        "observation id; Atlas reloads canonical evidence and routing context before writing."
    ),
    operation_id="createFirehoseObservationDelivery",
    tags=["firehose-internal"],
)
async def create_observation_delivery(
    payload: dict[str, Any],
    response: Response,
    _internal: None = Depends(require_internal_firehose_request),
    db: Any = Depends(get_internal_firehose_db),
) -> FirehoseObservationSignalsResponse:
    """Accept one Pub/Sub-style observation delivery."""
    try:
        delivery = parse_observation_delivery(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=INVALID_OBSERVATION_DELIVERY_MESSAGE,
        ) from exc

    return await create_observation_signals(
        delivery.observation_id,
        response,
        _internal,
        db,
    )
