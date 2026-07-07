"""Public Firehose proof feed endpoints."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings

from .models import FirehoseSignalCRUD, FirehoseSignalModel, FirehoseSignalQuery

router = APIRouter()

PUBLIC_FIREHOSE_WEBSOCKET_PROTOCOL = "atlas.firehose.public.v1"
PUBLIC_FIREHOSE_CACHE = "public, max-age=30, s-maxage=30"
PUBLIC_FIREHOSE_SENSITIVITY_THRESHOLD = 0.5

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator

STATE_ABBREVIATION_LENGTH = 2

PublicSignalType = Literal[
    "public_meeting",
    "coalition_activity",
    "grant_award",
    "new_source",
]
PublicReviewState = Literal["not_required", "pending", "approved", "held"]
PublicVisibility = Literal["public", "workspace", "reviewer"]


def _now_iso() -> str:
    """Return the current UTC time for public Firehose snapshots."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class PublicFirehoseQueryParams(BaseModel):
    """Raw public Firehose query parameters."""

    place: list[str] = Field(default_factory=list)
    issue: list[str] = Field(default_factory=list)
    signal_type: list[str] = Field(default_factory=list)
    source_class: list[str] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=50)

    @field_validator("place", "issue", "signal_type", "source_class", mode="before")
    @classmethod
    def normalize_multi_value(cls, value: Any) -> list[str]:
        """Accept repeated or comma-delimited query values."""
        if value is None:
            return []
        values = value if isinstance(value, list) else [value]
        normalized: list[str] = []
        for item in values:
            normalized.extend(part.strip() for part in str(item).split(",") if part.strip())
        return normalized


class PublicFirehosePlace(BaseModel):
    """Public place label attached to a signal."""

    label: str
    slug: str


class PublicFirehoseIssue(BaseModel):
    """Public issue label attached to a signal."""

    label: str
    slug: str


class PublicFirehoseEvidence(BaseModel):
    """Public source evidence for one signal."""

    captured_at: str
    content_hash: str
    passage: str
    published_at: str | None
    publisher: str
    source_class: str
    source_url: str
    title: str


class PublicFirehoseSignal(BaseModel):
    """Public-safe Firehose signal."""

    confidence: float = Field(..., ge=0, le=1)
    detected_at: str
    evidence: PublicFirehoseEvidence
    id: str
    issues: list[PublicFirehoseIssue]
    occurred_at: str | None
    places: list[PublicFirehosePlace]
    public_realm_basis: str
    review_state: PublicReviewState
    sensitivity: float = Field(..., ge=0, le=1)
    signal_type: PublicSignalType
    summary: str
    title: str
    visibility: PublicVisibility


class PublicFirehoseSummary(BaseModel):
    """Summary of the public Firehose snapshot."""

    latest_detected_at: str | None
    total_signals: int = Field(..., ge=0)
    visible_signals: int = Field(..., ge=0)


class PublicFirehoseSnapshot(BaseModel):
    """Public Firehose feed snapshot."""

    generated_at: str
    query: PublicFirehoseQueryParams
    signals: list[PublicFirehoseSignal]
    summary: PublicFirehoseSummary


class PublicFirehoseReadyEvent(BaseModel):
    """Public Firehose stream readiness event."""

    query: PublicFirehoseQueryParams
    type: Literal["firehose.ready"] = "firehose.ready"


class PublicFirehoseSignalEvent(BaseModel):
    """Public Firehose signal event."""

    signal: PublicFirehoseSignal
    type: Literal["firehose.signal"] = "firehose.signal"


class PublicFirehoseHeartbeatEvent(BaseModel):
    """Public Firehose heartbeat event."""

    type: Literal["heartbeat"] = "heartbeat"


async def get_public_firehose_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[Any, None]:
    """Yield a per-request public Firehose database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _label_from_slug(slug: str) -> str:
    """Return a readable label for a stored place or issue slug."""
    normalized = slug.replace("_", "-")
    parts = normalized.split("-")
    if len(parts) > 1 and len(parts[-1]) == STATE_ABBREVIATION_LENGTH:
        return f"{' '.join(parts[:-1]).title()}, {parts[-1].upper()}"
    return normalized.replace("-", " ").title()


def _stored_signal_is_public_safe(signal: FirehoseSignalModel) -> bool:
    """Return whether a stored signal is safe for the public proof feed."""
    return (
        signal.visibility == "public"
        and signal.review_state == "not_required"
        and signal.sensitivity < PUBLIC_FIREHOSE_SENSITIVITY_THRESHOLD
        and any(
            destination.type == "public" and destination.state == "active"
            for destination in signal.destinations
        )
    )


def _stored_public_signal(signal: FirehoseSignalModel) -> PublicFirehoseSignal:
    """Convert one stored Firehose signal into the public proof-feed shape."""
    evidence = signal.evidence[0]
    return PublicFirehoseSignal(
        confidence=signal.confidence,
        detected_at=signal.detected_at,
        evidence=PublicFirehoseEvidence(
            captured_at=evidence.captured_at,
            content_hash=evidence.content_hash,
            passage=evidence.passage,
            published_at=evidence.published_at,
            publisher=evidence.publisher or "Unknown source",
            source_class=evidence.source_class,
            source_url=evidence.source_url,
            title=evidence.title or signal.title,
        ),
        id=signal.id,
        issues=[
            PublicFirehoseIssue(label=_label_from_slug(issue), slug=issue)
            for issue in signal.issues
        ],
        occurred_at=signal.occurred_at,
        places=[
            PublicFirehosePlace(label=_label_from_slug(place), slug=place)
            for place in signal.places
        ],
        public_realm_basis=signal.public_realm_basis,
        review_state=cast("PublicReviewState", signal.review_state),
        sensitivity=signal.sensitivity,
        signal_type=cast("PublicSignalType", signal.type),
        summary=signal.summary,
        title=signal.title,
        visibility=cast("PublicVisibility", signal.visibility),
    )


async def _snapshot(
    conn: Any,
    query: PublicFirehoseQueryParams,
) -> PublicFirehoseSnapshot:
    """Build a stored public Firehose snapshot."""
    stored = await FirehoseSignalCRUD.list_for_query(
        conn,
        FirehoseSignalQuery(
            org_id=None,
            places=query.place,
            issues=query.issue,
            signal_types=query.signal_type,
            source_classes=query.source_class,
            visibility="public",
            limit=query.limit,
        ),
    )
    signals = [
        _stored_public_signal(signal) for signal in stored if _stored_signal_is_public_safe(signal)
    ][: query.limit]
    return PublicFirehoseSnapshot(
        generated_at=_now_iso(),
        query=query,
        signals=signals,
        summary=PublicFirehoseSummary(
            latest_detected_at=signals[0].detected_at if signals else None,
            total_signals=len(signals),
            visible_signals=len(signals),
        ),
    )


def _query_from_params(
    *,
    issue: list[str] | None,
    limit: int,
    place: list[str] | None,
    signal_type: list[str] | None,
    source_class: list[str] | None,
) -> PublicFirehoseQueryParams:
    """Return normalized public Firehose query params."""
    return PublicFirehoseQueryParams(
        issue=issue,
        limit=limit,
        place=place,
        signal_type=signal_type,
        source_class=source_class,
    )


def _sse_message(event: str, event_id: str, data: str) -> str:
    """Serialize one Server-Sent Event frame."""
    return f"id: {event_id}\nevent: {event}\ndata: {data}\n\n"


async def _event_stream(snapshot: PublicFirehoseSnapshot) -> AsyncIterator[str]:
    """Yield a finite public Firehose proof stream."""
    ready = PublicFirehoseReadyEvent(query=snapshot.query)
    yield _sse_message("firehose.ready", "fhp_ready", ready.model_dump_json())
    for signal in snapshot.signals:
        event = PublicFirehoseSignalEvent(signal=signal)
        yield _sse_message("firehose.signal", signal.id, event.model_dump_json())
    yield _sse_message(
        "heartbeat", "fhp_heartbeat", PublicFirehoseHeartbeatEvent().model_dump_json()
    )


@router.get(
    "/firehose/public",
    response_model=PublicFirehoseSnapshot,
    operation_id="getPublicFirehose",
    tags=["firehose"],
)
async def get_public_firehose(  # noqa: PLR0913
    place: Annotated[list[str] | None, Query()] = None,
    issue: Annotated[list[str] | None, Query()] = None,
    signal_type: Annotated[list[str] | None, Query()] = None,
    source_class: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
    db: Any = Depends(get_public_firehose_db),
) -> JSONResponse:
    """Return a public-safe Firehose proof snapshot."""
    query = _query_from_params(
        issue=issue,
        limit=limit,
        place=place,
        signal_type=signal_type,
        source_class=source_class,
    )
    snapshot = await _snapshot(db, query)
    headers = {"Cache-Control": PUBLIC_FIREHOSE_CACHE}

    return JSONResponse(snapshot.model_dump(mode="json"), headers=headers)


@router.get(
    "/firehose/public/events",
    operation_id="streamPublicFirehoseEvents",
    tags=["firehose"],
)
async def stream_public_firehose_events(  # noqa: PLR0913
    place: Annotated[list[str] | None, Query()] = None,
    issue: Annotated[list[str] | None, Query()] = None,
    signal_type: Annotated[list[str] | None, Query()] = None,
    source_class: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
    db: Any = Depends(get_public_firehose_db),
) -> StreamingResponse:
    """Stream public-safe Firehose proof events."""
    snapshot = await _snapshot(
        db,
        _query_from_params(
            issue=issue,
            limit=limit,
            place=place,
            signal_type=signal_type,
            source_class=source_class,
        ),
    )
    response = StreamingResponse(_event_stream(snapshot), media_type="text/event-stream")
    response.headers["Cache-Control"] = "no-store, no-transform"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@router.websocket("/firehose/public/socket")
async def public_firehose_socket(  # noqa: PLR0913
    websocket: WebSocket,
    place: Annotated[list[str] | None, Query()] = None,
    issue: Annotated[list[str] | None, Query()] = None,
    signal_type: Annotated[list[str] | None, Query()] = None,
    source_class: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
    db: Any = Depends(get_public_firehose_db),
) -> None:
    """Open the public Firehose proof WebSocket."""
    requested_protocols = websocket.headers.get("sec-websocket-protocol", "")
    if PUBLIC_FIREHOSE_WEBSOCKET_PROTOCOL not in {
        protocol.strip() for protocol in requested_protocols.split(",")
    }:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    snapshot = await _snapshot(
        db,
        _query_from_params(
            issue=issue,
            limit=limit,
            place=place,
            signal_type=signal_type,
            source_class=source_class,
        ),
    )
    await websocket.accept(subprotocol=PUBLIC_FIREHOSE_WEBSOCKET_PROTOCOL)
    await websocket.send_json(
        PublicFirehoseReadyEvent(query=snapshot.query).model_dump(mode="json")
    )
    for signal in snapshot.signals:
        await websocket.send_json(PublicFirehoseSignalEvent(signal=signal).model_dump(mode="json"))
    await websocket.send_json(PublicFirehoseHeartbeatEvent().model_dump(mode="json"))
    while True:
        try:
            await asyncio.wait_for(websocket.receive_text(), timeout=15)
        except TimeoutError:
            await websocket.send_json(PublicFirehoseHeartbeatEvent().model_dump(mode="json"))
        except WebSocketDisconnect:
            return
