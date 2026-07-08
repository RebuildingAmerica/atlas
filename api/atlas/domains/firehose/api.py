"""Firehose query and live observation API."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    Header,
    Query,
    Request,
    Response,
    WebSocket,
    status,
)
from fastapi.responses import StreamingResponse  # noqa: TC002

from atlas.domains.access import AuthenticatedActor, require_org_actor_permission
from atlas.domains.access.api_keys import verify_api_key
from atlas.domains.access.jwt import verify_bearer_jwt
from atlas.platform.config import Settings, get_settings

from .api_helpers import (
    _apply_firehose_headers,
    _now,
    _query_fingerprint,
    _session_id,
    _session_response,
    _snapshot_content_location,
    _snapshot_response,
    _streaming_response,
    _usage_context,
    _workspace_context,
    get_firehose_db,
)
from .api_socket import _websocket_actor, _websocket_subprotocol
from .http import (
    FIREHOSE_VARY,
    FirehoseHttpContext,
    FirehoseResponseHeaderContext,
    apply_http_context_headers,
    firehose_http_context,
    firehose_json_http_context,
)
from .schemas import (
    FirehoseQuery,
    FirehoseQueryParams,
    FirehoseReadyEvent,
    FirehoseSession,
    FirehoseSessionRequest,
    FirehoseSnapshot,
    FirehoseSort,
    FirehoseVisibility,
)
from .serving import list_stored_signals

router = APIRouter()

__all__ = ["router", "verify_api_key", "verify_bearer_jwt"]


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
    db: Any = Depends(get_firehose_db),
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
    signals = await list_stored_signals(db, org_id=workspace.org_id, query=query)
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
        signals=signals,
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
    db: Any = Depends(get_firehose_db),
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
    signals = await list_stored_signals(db, org_id=workspace.org_id, query=query)
    if http_context.representation == "sse":
        return _streaming_response(
            query=query,
            signals=signals,
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
        signals=signals,
    )
    if request.headers.get("if-none-match") == etag:
        response.status_code = status.HTTP_304_NOT_MODIFIED
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=dict(response.headers))

    return _snapshot_response(
        query=query,
        workspace=workspace,
        meter="firehose_snapshot",
        signals=signals,
    )


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
        signals=[],
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
