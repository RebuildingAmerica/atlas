"""Shared helpers for the Firehose API routes."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

from fastapi import Depends, Response
from fastapi.responses import StreamingResponse

from atlas.models import get_db_connection
from atlas.platform.config import get_settings

from .http import (
    FIREHOSE_SSE_RETRY_MS,
    FIREHOSE_VARY,
    FirehoseHttpContext,
    FirehoseResponseHeaderContext,
    apply_http_context_headers,
)
from .schemas import (
    FirehoseHeartbeatEvent,
    FirehoseLinkSet,
    FirehoseQuery,
    FirehoseReadyEvent,
    FirehoseSession,
    FirehoseSignal,
    FirehoseSignalEvent,
    FirehoseSnapshot,
    FirehoseSummary,
    FirehoseUsageContext,
    FirehoseUsageMeter,
    FirehoseWorkspaceContext,
)
from .serving import signal_summary

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator

    from atlas.domains.access import AuthenticatedActor
    from atlas.platform.config import Settings

DEFAULT_FIREHOSE_LIMIT = 50
SESSION_TTL = timedelta(hours=4)


def _now() -> datetime:
    """Return the current UTC time for Firehose response timestamps."""
    return datetime.now(UTC)


def _iso(value: datetime) -> str:
    """Serialize a datetime in the API's UTC timestamp form."""
    return value.isoformat().replace("+00:00", "Z")


def _query_fingerprint(query: FirehoseQuery) -> str:
    """Return a stable fingerprint for metering and reconnect dedupe."""
    payload = json.dumps(
        query.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _workspace_context(actor: AuthenticatedActor) -> FirehoseWorkspaceContext:
    """Return the workspace billing context for one actor."""
    return FirehoseWorkspaceContext(
        org_id=actor.org_id or "local",
        actor_id=actor.user_id,
        auth_type=actor.auth_type,
        api_key_id=actor.api_key_id,
    )


def _usage_context(
    query: FirehoseQuery,
    meter: FirehoseUsageMeter,
) -> FirehoseUsageContext:
    """Return the usage context for one Firehose request."""
    return FirehoseUsageContext(
        meter=meter,
        query_fingerprint=_query_fingerprint(query),
    )


def _session_id(query: FirehoseQuery, idempotency_key: str | None) -> str:
    """Return a deterministic stub session id for an observed query."""
    source = idempotency_key or _query_fingerprint(query)
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]
    return f"fhs_{digest}"


def _empty_summary() -> FirehoseSummary:
    """Return the empty Firehose summary for stubbed reads."""
    return FirehoseSummary(
        total_signals=0,
        visible_signals=0,
        held_signals=0,
        latest_cursor=None,
    )


def _signals_version(signals: list[FirehoseSignal]) -> str:
    """Return a compact validator fragment for one stored signal result set."""
    payload = "|".join(f"{signal.id}:{signal.detected_at}" for signal in signals)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


async def get_firehose_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[Any, None]:
    """Yield a per-request Firehose database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _links(*, query: FirehoseQuery, session_id: str | None = None) -> FirehoseLinkSet:
    """Return response links for a Firehose snapshot."""
    if session_id is not None:
        base = f"/api/firehose/sessions/{session_id}"
        return FirehoseLinkSet(
            self=base,
            next=None,
            events=f"{base}/events",
        )

    next_cursor = query.cursor or ""
    return FirehoseLinkSet(
        self="/api/firehose",
        next=f"/api/firehose?cursor={next_cursor}",
        events="/api/firehose",
    )


def _canonical_firehose_path(query: FirehoseQuery) -> str:
    """Return the normalized URL path for one top-level Firehose query."""
    params: list[tuple[str, str]] = []
    params.extend(("place", value) for value in query.places)
    params.extend(("issue", value) for value in query.issues)
    params.extend(("actor_type", value) for value in query.actor_types)
    params.extend(("signal_type", value) for value in query.signal_types)
    params.extend(("source_class", value) for value in query.source_classes)
    if query.visibility != "workspace":
        params.append(("visibility", query.visibility))
    if query.since is not None:
        params.append(("since", query.since))
    if query.until is not None:
        params.append(("until", query.until))
    if query.cursor is not None:
        params.append(("cursor", query.cursor))
    if query.limit != DEFAULT_FIREHOSE_LIMIT:
        params.append(("limit", str(query.limit)))
    if query.sort != "detected_at_desc":
        params.append(("sort", query.sort))
    encoded_params = urlencode(params)
    return f"/api/firehose?{encoded_params}" if encoded_params else "/api/firehose"


def _snapshot_content_location(query: FirehoseQuery, session_id: str | None) -> str:
    """Return the canonical Content-Location for a snapshot response."""
    if session_id is not None:
        return f"/api/firehose/sessions/{session_id}"
    return _canonical_firehose_path(query)


def _events_content_location(query: FirehoseQuery, session_id: str | None) -> str:
    """Return the canonical Content-Location for a stream response."""
    if session_id is not None:
        return f"/api/firehose/sessions/{session_id}/events"
    return _canonical_firehose_path(query)


def _session_response(
    *,
    session_id: str,
    query: FirehoseQuery,
    workspace: FirehoseWorkspaceContext,
    created_at: datetime,
) -> FirehoseSession:
    """Build a durable Firehose session response."""
    usage = _usage_context(query, "firehose_session")
    return FirehoseSession(
        id=session_id,
        state="active",
        query=query,
        workspace=workspace,
        usage=usage,
        created_at=_iso(created_at),
        expires_at=_iso(created_at + SESSION_TTL),
        snapshot_url=f"/api/firehose/sessions/{session_id}",
        events_url=f"/api/firehose/sessions/{session_id}/events",
        socket_url=f"/api/firehose/sessions/{session_id}/socket",
    )


def _snapshot_response(
    *,
    query: FirehoseQuery,
    workspace: FirehoseWorkspaceContext,
    meter: FirehoseUsageMeter,
    session: FirehoseSession | None = None,
    signals: list[FirehoseSignal] | None = None,
) -> FirehoseSnapshot:
    """Build an empty but fully typed Firehose snapshot."""
    visible_signals = signals or []
    return FirehoseSnapshot(
        query=query,
        workspace=workspace,
        usage=_usage_context(query, meter),
        generated_at=_iso(_now()),
        cursor=query.cursor,
        summary=signal_summary(visible_signals) if signals is not None else _empty_summary(),
        signals=visible_signals,
        links=_links(query=query, session_id=session.id if session else None),
        session=session,
    )


def _apply_firehose_headers(
    response: Response,
    *,
    query: FirehoseQuery,
    header_context: FirehoseResponseHeaderContext,
    signals: list[FirehoseSignal] | None = None,
    session_id: str | None = None,
) -> str:
    """Apply cache, validator, and pagination headers to one response."""
    signal_version = _signals_version(signals) if signals is not None else "empty"
    etag_source = f"{session_id or 'firehose'}:{_query_fingerprint(query)}:{signal_version}"
    etag = f'"firehose-{hashlib.sha256(etag_source.encode("utf-8")).hexdigest()[:32]}"'
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = FIREHOSE_VARY
    response.headers["ETag"] = etag
    response.headers["Link"] = (
        f'<{_links(query=query, session_id=session_id).next or ""}>; rel="next"'
    )
    apply_http_context_headers(
        response,
        header_context=header_context,
    )
    return etag


def _sse_message(
    *,
    event: str,
    event_id: str,
    data: str,
    retry_ms: int | None = None,
) -> str:
    """Serialize one Server-Sent Event frame."""
    retry = f"retry: {retry_ms}\n" if retry_ms is not None else ""
    return f"id: {event_id}\n{retry}event: {event}\ndata: {data}\n\n"


async def _sse_stream(
    *,
    query: FirehoseQuery,
    signals: list[FirehoseSignal],
    workspace: FirehoseWorkspaceContext,
    session_id: str | None,
    last_event_id: str | None,
) -> AsyncIterator[str]:
    """Yield the finite stub stream used by the Firehose MVP contract."""
    usage = _usage_context(query, "firehose_stream")
    ready = FirehoseReadyEvent(
        session_id=session_id,
        workspace=workspace,
        usage=usage,
        query=query,
        last_event_id=last_event_id,
    )
    yield _sse_message(
        event="firehose.ready",
        event_id="fhe_ready",
        data=ready.model_dump_json(),
        retry_ms=FIREHOSE_SSE_RETRY_MS,
    )

    for signal in signals:
        event = FirehoseSignalEvent(
            event_id=signal.id,
            session_id=session_id,
            workspace=workspace,
            usage=usage,
            query=query,
            signal=signal,
            delivered_at=_iso(_now()),
        )
        yield _sse_message(
            event="firehose.signal",
            event_id=signal.id,
            data=event.model_dump_json(),
        )

    heartbeat = FirehoseHeartbeatEvent(session_id=session_id)
    yield _sse_message(
        event="heartbeat",
        event_id="fhe_heartbeat",
        data=heartbeat.model_dump_json(),
    )


def _streaming_response(  # noqa: PLR0913
    *,
    query: FirehoseQuery,
    signals: list[FirehoseSignal],
    workspace: FirehoseWorkspaceContext,
    http_context: FirehoseHttpContext,
    session_id: str | None,
    last_event_id: str | None,
) -> StreamingResponse:
    """Return an SSE response for the Firehose query surface."""
    response = StreamingResponse(
        _sse_stream(
            query=query,
            signals=signals,
            workspace=workspace,
            session_id=session_id,
            last_event_id=last_event_id,
        ),
        media_type="text/event-stream",
    )
    response.headers["Cache-Control"] = "no-store, no-transform"
    response.headers["Vary"] = FIREHOSE_VARY
    response.headers["X-Accel-Buffering"] = "no"
    apply_http_context_headers(
        response,
        header_context=FirehoseResponseHeaderContext(
            request=http_context,
            workspace_id=workspace.org_id,
            usage_meter="firehose_stream",
            query_fingerprint=_query_fingerprint(query),
            content_location=_events_content_location(query, session_id),
            preference_applied=http_context.preferences.applied_header(include_return=False),
        ),
    )
    return response
