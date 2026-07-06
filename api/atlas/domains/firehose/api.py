"""Firehose query and live observation API."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Annotated
from urllib.parse import urlencode

from fastapi import (
    APIRouter,
    Depends,
    Header,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketException,
    status,
)
from fastapi.responses import StreamingResponse

from atlas.domains.access import AuthenticatedActor, require_org_actor_permission
from atlas.domains.access.api_keys import verify_api_key
from atlas.domains.access.internal import build_local_actor, verify_internal_actor
from atlas.domains.access.jwt import verify_bearer_jwt
from atlas.domains.access.permissions import require_permission
from atlas.platform.config import Settings, get_settings

from .http import (
    FIREHOSE_SSE_RETRY_MS,
    FIREHOSE_VARY,
    FIREHOSE_WEBSOCKET_PROTOCOL,
    FirehoseHttpContext,
    FirehoseResponseHeaderContext,
    apply_http_context_headers,
    firehose_http_context,
    firehose_json_http_context,
)
from .schemas import (
    FirehoseHeartbeatEvent,
    FirehoseLinkSet,
    FirehoseQuery,
    FirehoseQueryParams,
    FirehoseReadyEvent,
    FirehoseSession,
    FirehoseSessionRequest,
    FirehoseSnapshot,
    FirehoseSort,
    FirehoseSummary,
    FirehoseUsageContext,
    FirehoseUsageMeter,
    FirehoseVisibility,
    FirehoseWorkspaceContext,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from atlas.domains.access.principals import ApiKeyPrincipal

router = APIRouter()

__all__ = ["router"]

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
) -> FirehoseSnapshot:
    """Build an empty but fully typed Firehose snapshot."""
    return FirehoseSnapshot(
        query=query,
        workspace=workspace,
        usage=_usage_context(query, meter),
        generated_at=_iso(_now()),
        cursor=query.cursor,
        summary=_empty_summary(),
        signals=[],
        links=_links(query=query, session_id=session.id if session else None),
        session=session,
    )


def _apply_firehose_headers(
    response: Response,
    *,
    query: FirehoseQuery,
    header_context: FirehoseResponseHeaderContext,
    session_id: str | None = None,
) -> str:
    """Apply cache, validator, and pagination headers to one response."""
    etag_source = f"{session_id or 'firehose'}:{_query_fingerprint(query)}"
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

    heartbeat = FirehoseHeartbeatEvent(session_id=session_id)
    yield _sse_message(
        event="heartbeat",
        event_id="fhe_heartbeat",
        data=heartbeat.model_dump_json(),
    )


def _streaming_response(
    *,
    query: FirehoseQuery,
    workspace: FirehoseWorkspaceContext,
    http_context: FirehoseHttpContext,
    session_id: str | None,
    last_event_id: str | None,
) -> StreamingResponse:
    """Return an SSE response for the Firehose query surface."""
    response = StreamingResponse(
        _sse_stream(
            query=query,
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


def _api_key_actor(principal: ApiKeyPrincipal) -> AuthenticatedActor:
    """Convert an API key principal into the shared actor shape."""
    return AuthenticatedActor(
        user_id=principal.user_id,
        email=principal.user_email,
        auth_type="api_key",
        api_key_id=principal.key_id,
        permissions=principal.permissions,
        org_id=principal.org_id,
    )


async def _websocket_actor(websocket: WebSocket, settings: Settings) -> AuthenticatedActor:
    """Authenticate a WebSocket caller for the Firehose session socket."""
    if settings.deploy_mode == "local":
        return build_local_actor()

    trusted_actor = verify_internal_actor(
        settings,
        websocket.headers.get("x-atlas-internal-secret"),
        websocket.headers.get("x-atlas-actor-id"),
        websocket.headers.get("x-atlas-actor-email"),
        org_id=websocket.headers.get("x-atlas-organization-id"),
    )
    if trusted_actor is not None:
        if trusted_actor.org_id is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
        return trusted_actor

    api_key = websocket.headers.get("x-api-key")
    if api_key:
        principal = await verify_api_key(api_key, settings)
        if principal is not None:
            actor = require_permission(_api_key_actor(principal), "firehose", "read")
            if actor.org_id is None:
                raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
            return actor

    jwt_payload = verify_bearer_jwt(
        websocket.headers.get("authorization"),
        issuer=settings.auth_jwt_issuer,
        audience=settings.auth_jwt_audience,
        jwks_url=settings.auth_jwt_jwks_url,
    )
    if jwt_payload:
        raw_org_id = jwt_payload.get("org_id")
        actor = AuthenticatedActor(
            user_id=str(jwt_payload["sub"]),
            email=str(jwt_payload.get("email", "")),
            auth_type="oauth_jwt",
            permissions=jwt_payload.get("permissions"),  # type: ignore[arg-type]
            org_id=str(raw_org_id) if raw_org_id is not None else None,
        )
        actor = require_permission(actor, "firehose", "read", settings=settings)
        if actor.org_id is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
        return actor

    raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)


def _websocket_subprotocol(websocket: WebSocket) -> str | None:
    """Return the negotiated Firehose WebSocket subprotocol."""
    raw_protocols = websocket.headers.get("sec-websocket-protocol")
    if raw_protocols is None:
        return None
    requested_protocols = [value.strip() for value in raw_protocols.split(",") if value.strip()]
    if FIREHOSE_WEBSOCKET_PROTOCOL in requested_protocols:
        return FIREHOSE_WEBSOCKET_PROTOCOL
    raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)


@router.head(
    "/firehose",
    summary="Probe Firehose",
    description=(
        "Return snapshot headers for a Firehose query without downloading the JSON response body."
    ),
    operation_id="headFirehose",
    tags=["firehose"],
)
async def head_firehose(  # noqa: PLR0913
    request: Request,
    response: Response,
    place: Annotated[list[str] | None, Query()] = None,
    issue: Annotated[list[str] | None, Query()] = None,
    actor_type: Annotated[list[str] | None, Query()] = None,
    signal_type: Annotated[list[str] | None, Query()] = None,
    source_class: Annotated[list[str] | None, Query()] = None,
    visibility: FirehoseVisibility = Query("workspace"),
    since: str | None = Query(None),
    until: str | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    sort: FirehoseSort = Query("detected_at_desc"),
    http_context: FirehoseHttpContext = Depends(firehose_http_context),
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
) -> Response:
    """Return Firehose snapshot metadata for cheap freshness checks."""
    query = FirehoseQueryParams(
        place=place,
        issue=issue,
        actor_type=actor_type,
        signal_type=signal_type,
        source_class=source_class,
        visibility=visibility,
        since=since,
        until=until,
        cursor=cursor,
        limit=limit,
        sort=sort,
    ).to_query()
    workspace = _workspace_context(actor)
    etag = _apply_firehose_headers(
        response,
        query=query,
        header_context=FirehoseResponseHeaderContext(
            request=http_context,
            workspace_id=workspace.org_id,
            usage_meter="firehose_snapshot",
            query_fingerprint=_query_fingerprint(query),
            content_location=_snapshot_content_location(query, None),
            preference_applied=http_context.preferences.applied_header(include_return=False),
        ),
    )
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=dict(response.headers))
    return Response(status_code=status.HTTP_200_OK, headers=dict(response.headers))


@router.get(
    "/firehose",
    response_model=FirehoseSnapshot,
    summary="Query Firehose",
    description=(
        "Return a source-backed Firehose snapshot for a civic query, or stream the same query "
        "as Server-Sent Events when the client requests text/event-stream."
    ),
    operation_id="getFirehose",
    tags=["firehose"],
)
async def get_firehose(  # noqa: PLR0913
    request: Request,
    response: Response,
    place: Annotated[list[str] | None, Query()] = None,
    issue: Annotated[list[str] | None, Query()] = None,
    actor_type: Annotated[list[str] | None, Query()] = None,
    signal_type: Annotated[list[str] | None, Query()] = None,
    source_class: Annotated[list[str] | None, Query()] = None,
    visibility: FirehoseVisibility = Query("workspace"),
    since: str | None = Query(None),
    until: str | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    sort: FirehoseSort = Query("detected_at_desc"),
    last_event_id: str | None = Header(None, alias="Last-Event-ID"),
    http_context: FirehoseHttpContext = Depends(firehose_http_context),
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
) -> FirehoseSnapshot | Response:
    """Query or observe the Firehose surface for one workspace-owned actor."""
    query = FirehoseQueryParams(
        place=place,
        issue=issue,
        actor_type=actor_type,
        signal_type=signal_type,
        source_class=source_class,
        visibility=visibility,
        since=since,
        until=until,
        cursor=cursor,
        limit=limit,
        sort=sort,
    ).to_query()
    workspace = _workspace_context(actor)
    if http_context.representation == "sse":
        return _streaming_response(
            query=query,
            workspace=workspace,
            http_context=http_context,
            session_id=None,
            last_event_id=last_event_id,
        )

    etag = _apply_firehose_headers(
        response,
        query=query,
        header_context=FirehoseResponseHeaderContext(
            request=http_context,
            workspace_id=workspace.org_id,
            usage_meter="firehose_snapshot",
            query_fingerprint=_query_fingerprint(query),
            content_location=_snapshot_content_location(query, None),
            preference_applied=http_context.preferences.applied_header(include_return=False),
        ),
    )
    if request.headers.get("if-none-match") == etag:
        response.status_code = status.HTTP_304_NOT_MODIFIED
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=dict(response.headers))

    return _snapshot_response(query=query, workspace=workspace, meter="firehose_snapshot")


@router.post(
    "/firehose/sessions",
    response_model=FirehoseSession,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Firehose session",
    description=(
        "Create a durable observed Firehose query when filters are too rich for URL parameters "
        "or a client needs stable live-session URLs."
    ),
    operation_id="createFirehoseSession",
    tags=["firehose"],
)
async def create_firehose_session(
    payload: FirehoseSessionRequest,
    response: Response,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    http_context: FirehoseHttpContext = Depends(firehose_json_http_context),
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
) -> FirehoseSession | Response:
    """Create an empty but durable Firehose observed query session."""
    workspace = _workspace_context(actor)
    session_id = _session_id(payload.query, idempotency_key)
    session = _session_response(
        session_id=session_id,
        query=payload.query,
        workspace=workspace,
        created_at=_now(),
    )
    response.headers["Location"] = session.snapshot_url
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = FIREHOSE_VARY
    apply_http_context_headers(
        response,
        header_context=FirehoseResponseHeaderContext(
            request=http_context,
            workspace_id=workspace.org_id,
            usage_meter="firehose_session",
            query_fingerprint=_query_fingerprint(payload.query),
            content_location=session.snapshot_url,
            preference_applied=http_context.preferences.applied_header(include_return=True),
        ),
    )
    if http_context.preferences.return_minimal:
        return Response(status_code=status.HTTP_201_CREATED, headers=dict(response.headers))
    return session


@router.get(
    "/firehose/sessions/{session_id}",
    response_model=FirehoseSnapshot,
    summary="Get Firehose session",
    description=(
        "Return the current snapshot for a durable Firehose session. The MVP stub keeps the "
        "session readable and typed before real persisted sessions exist."
    ),
    operation_id="getFirehoseSession",
    tags=["firehose"],
)
async def get_firehose_session(
    session_id: str,
    request: Request,
    response: Response,
    http_context: FirehoseHttpContext = Depends(firehose_http_context),
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
) -> FirehoseSnapshot | Response:
    """Return an empty snapshot for one Firehose session."""
    query = FirehoseQuery()
    workspace = _workspace_context(actor)
    session = _session_response(
        session_id=session_id,
        query=query,
        workspace=workspace,
        created_at=_now(),
    )
    etag = _apply_firehose_headers(
        response,
        query=query,
        header_context=FirehoseResponseHeaderContext(
            request=http_context,
            workspace_id=workspace.org_id,
            usage_meter="firehose_snapshot",
            query_fingerprint=_query_fingerprint(query),
            content_location=_snapshot_content_location(query, session_id),
            preference_applied=http_context.preferences.applied_header(include_return=False),
        ),
        session_id=session_id,
    )
    if request.headers.get("if-none-match") == etag:
        response.status_code = status.HTTP_304_NOT_MODIFIED
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=dict(response.headers))
    return _snapshot_response(
        query=query,
        workspace=workspace,
        meter="firehose_snapshot",
        session=session,
    )


@router.get(
    "/firehose/sessions/{session_id}/events",
    summary="Stream Firehose session events",
    description=(
        "Stream Server-Sent Events for a durable Firehose session. Clients can reconnect with "
        "Last-Event-ID without changing the query contract."
    ),
    operation_id="streamFirehoseSessionEvents",
    tags=["firehose"],
)
async def stream_firehose_session_events(
    session_id: str,
    last_event_id: str | None = Header(None, alias="Last-Event-ID"),
    http_context: FirehoseHttpContext = Depends(firehose_http_context),
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
) -> StreamingResponse:
    """Stream Firehose events for one durable session."""
    query = FirehoseQuery()
    return _streaming_response(
        query=query,
        workspace=_workspace_context(actor),
        http_context=http_context,
        session_id=session_id,
        last_event_id=last_event_id,
    )


@router.websocket("/firehose/sessions/{session_id}/socket")
async def firehose_session_socket(
    websocket: WebSocket,
    session_id: str,
    settings: Settings = Depends(get_settings),
) -> None:
    """Open the future bidirectional Firehose session socket."""
    actor = await _websocket_actor(websocket, settings)
    subprotocol = _websocket_subprotocol(websocket)
    query = FirehoseQuery()
    workspace = _workspace_context(actor)
    ready = FirehoseReadyEvent(
        session_id=session_id,
        workspace=workspace,
        usage=_usage_context(query, "firehose_socket"),
        query=query,
        last_event_id=None,
    )
    await websocket.accept(subprotocol=subprotocol)
    await websocket.send_json(ready.model_dump(mode="json"))
    await websocket.close()
