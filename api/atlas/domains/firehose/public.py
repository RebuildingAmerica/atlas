"""Public Firehose proof feed endpoints."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any, cast

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse, StreamingResponse

from .api_helpers import get_firehose_db
from .models import FirehoseSignalCRUD, FirehoseSignalModel, FirehoseSignalQuery
from .public_models import (
    PUBLIC_FIREHOSE_FIXTURES,
    PublicFirehoseEvidence,
    PublicFirehoseHeartbeatEvent,
    PublicFirehoseIssue,
    PublicFirehosePlace,
    PublicFirehoseQueryParams,
    PublicFirehoseReadyEvent,
    PublicFirehoseSignal,
    PublicFirehoseSignalEvent,
    PublicFirehoseSnapshot,
    PublicFirehoseSummary,
    PublicSignalType,
)

router = APIRouter()

PUBLIC_FIREHOSE_WEBSOCKET_PROTOCOL = "atlas.firehose.public.v1"
PUBLIC_FIREHOSE_CACHE = "public, max-age=30, s-maxage=30"
PUBLIC_FIREHOSE_SENSITIVITY_THRESHOLD = 0.5

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def _matches(values: list[str], filters: list[str]) -> bool:
    """Return whether any candidate value matches the active filters."""
    return not filters or any(value in filters for value in values)


def _public_safe(signal: PublicFirehoseSignal) -> bool:
    """Return whether a signal is safe for the public proof feed."""
    return (
        signal.visibility == "public"
        and signal.review_state == "not_required"
        and signal.sensitivity < PUBLIC_FIREHOSE_SENSITIVITY_THRESHOLD
    )


def _signal_matches_query(
    signal: PublicFirehoseSignal,
    query: PublicFirehoseQueryParams,
) -> bool:
    """Return whether a public signal matches a query."""
    return (
        _matches([place.slug for place in signal.places], query.place)
        and _matches([issue.slug for issue in signal.issues], query.issue)
        and _matches([signal.signal_type], query.signal_type)
        and _matches([signal.evidence.source_class], query.source_class)
    )


def _generated_at() -> str:
    """Return the current UTC timestamp for public snapshot metadata."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _label_from_slug(slug: str) -> str:
    """Return a readable label for a stored public feed slug."""
    return " ".join(part.capitalize() for part in slug.replace("_", "-").split("-"))


def _has_public_route(signal: FirehoseSignalModel) -> bool:
    """Return whether a stored signal is explicitly routed to the public feed."""
    return any(
        destination.type == "public" and destination.state == "active"
        for destination in signal.destinations
    )


def _stored_public_signal(signal: FirehoseSignalModel) -> PublicFirehoseSignal | None:
    """Adapt a stored Firehose signal into the public proof-feed shape."""
    if not _has_public_route(signal) or not signal.evidence:
        return None

    evidence = signal.evidence[0]
    return PublicFirehoseSignal(
        confidence=signal.confidence,
        detected_at=signal.detected_at,
        evidence=PublicFirehoseEvidence(
            captured_at=evidence.captured_at,
            content_hash=evidence.content_hash,
            passage=evidence.passage,
            published_at=evidence.published_at,
            publisher=evidence.publisher or "",
            source_class=evidence.source_class,
            source_url=evidence.source_url,
            title=evidence.title or "",
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
        review_state=signal.review_state,
        sensitivity=signal.sensitivity,
        signal_type=cast("PublicSignalType", signal.type),
        summary=signal.summary,
        title=signal.title,
        visibility=signal.visibility,
    )


async def _stored_signals(
    db: Any,
    query: PublicFirehoseQueryParams,
) -> list[PublicFirehoseSignal]:
    """Return stored public-routed signals for the public proof feed."""
    stored = await FirehoseSignalCRUD.list_for_query(
        db,
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
    signals = [_stored_public_signal(signal) for signal in stored]
    return [signal for signal in signals if signal is not None]


async def _snapshot(
    query: PublicFirehoseQueryParams,
    *,
    db: Any | None = None,
) -> PublicFirehoseSnapshot:
    """Build a public Firehose snapshot from stored signals and proof fixtures."""
    stored_signals = await _stored_signals(db, query) if db is not None else []
    fixture_signals = [
        signal
        for signal in sorted(
            PUBLIC_FIREHOSE_FIXTURES,
            key=lambda item: item.detected_at,
            reverse=True,
        )
        if _public_safe(signal) and _signal_matches_query(signal, query)
    ]
    signals = sorted(
        [*stored_signals, *fixture_signals],
        key=lambda item: item.detected_at,
        reverse=True,
    )[: query.limit]
    return PublicFirehoseSnapshot(
        generated_at=_generated_at(),
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
    db: Any = Depends(get_firehose_db),
) -> JSONResponse:
    """Return a public-safe Firehose proof snapshot."""
    query = _query_from_params(
        issue=issue,
        limit=limit,
        place=place,
        signal_type=signal_type,
        source_class=source_class,
    )
    snapshot = await _snapshot(query, db=db)
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
    db: Any = Depends(get_firehose_db),
) -> StreamingResponse:
    """Stream public-safe Firehose proof events."""
    snapshot = await _snapshot(
        _query_from_params(
            issue=issue,
            limit=limit,
            place=place,
            signal_type=signal_type,
            source_class=source_class,
        ),
        db=db,
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
    db: Any = Depends(get_firehose_db),
) -> None:
    """Open the public Firehose proof WebSocket."""
    requested_protocols = websocket.headers.get("sec-websocket-protocol", "")
    if PUBLIC_FIREHOSE_WEBSOCKET_PROTOCOL not in {
        protocol.strip() for protocol in requested_protocols.split(",")
    }:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    snapshot = await _snapshot(
        _query_from_params(
            issue=issue,
            limit=limit,
            place=place,
            signal_type=signal_type,
            source_class=source_class,
        ),
        db=db,
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
