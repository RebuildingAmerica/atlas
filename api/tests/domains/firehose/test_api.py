"""Firehose query surface contract tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException, WebSocketException
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from atlas.domains.access import ApiKeyPrincipal
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.firehose import api as firehose_api
from atlas.domains.firehose import http as firehose_http
from atlas.main import create_app
from atlas.platform.config import Settings, get_settings

FINGERPRINT_LENGTH = 64
DEFAULT_FIREHOSE_LIMIT = 50
FIREHOSE_VARY = "Accept, Authorization, X-API-Key, Prefer, Last-Event-ID, Accept-Encoding"
FIREHOSE_RATE_LIMIT = "600;w=60"
FIREHOSE_RATE_LIMIT_REMAINING = "600"
FIREHOSE_RATE_LIMIT_RESET = "60"
FIREHOSE_SSE_RETRY_MS = 3000
FIREHOSE_WEBSOCKET_PROTOCOL = "atlas.firehose.v1"
FIREHOSE_WEBSOCKET_POLICY_VIOLATION = 1008
SUPPORTED_FIREHOSE_REPRESENTATIONS = "application/json, text/event-stream"
VALID_TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


class _FakeWebSocket:
    """Minimal WebSocket stand-in for auth helper coverage."""

    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = Headers(headers)


@pytest.mark.asyncio
async def test_firehose_snapshot_returns_empty_workspace_scoped_view(
    test_client: object,
) -> None:
    """A Firehose snapshot should expose the final query surface with no mock data."""
    response = await test_client.get(
        "/api/firehose",
        params={
            "place": "las-vegas-nv",
            "issue": "housing",
            "signal_type": "public_meeting",
        },
        headers={"Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == FIREHOSE_VARY
    assert response.headers["etag"].startswith('"firehose-')
    assert response.headers["link"] == '</api/firehose?cursor=>; rel="next"'

    body = response.json()
    assert body["workspace"] == {
        "org_id": "local",
        "actor_id": "local-operator",
        "auth_type": "local",
        "api_key_id": None,
    }
    assert body["query"]["places"] == ["las-vegas-nv"]
    assert body["query"]["issues"] == ["housing"]
    assert body["query"]["signal_types"] == ["public_meeting"]
    assert body["summary"] == {
        "total_signals": 0,
        "visible_signals": 0,
        "held_signals": 0,
        "latest_cursor": None,
    }
    assert body["signals"] == []
    assert body["usage"]["meter"] == "firehose_snapshot"
    assert len(body["usage"]["query_fingerprint"]) == FINGERPRINT_LENGTH


@pytest.mark.asyncio
async def test_firehose_snapshot_consumes_standard_http_headers(test_client: object) -> None:
    """Request headers should affect the response contract, not disappear silently."""
    response = await test_client.get(
        "/api/firehose",
        params={"place": "las-vegas-nv"},
        headers={
            "Accept": "application/json",
            "X-Request-ID": "req_firehose_test",
            "Traceparent": VALID_TRACEPARENT,
            "Tracestate": "atlas=workspace",
            "Prefer": "wait=15",
        },
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert response.headers["x-request-id"] == "req_firehose_test"
    assert response.headers["traceparent"] == VALID_TRACEPARENT
    assert response.headers["tracestate"] == "atlas=workspace"
    assert response.headers["preference-applied"] == "wait=15"
    assert response.headers["content-location"].startswith("/api/firehose?")
    assert "place=las-vegas-nv" in response.headers["content-location"]
    assert response.headers["ratelimit-limit"] == FIREHOSE_RATE_LIMIT
    assert response.headers["ratelimit-remaining"] == FIREHOSE_RATE_LIMIT_REMAINING
    assert response.headers["ratelimit-reset"] == FIREHOSE_RATE_LIMIT_RESET
    assert response.headers["server-timing"].startswith("auth;dur=0")
    assert response.headers["x-atlas-workspace-id"] == "local"
    assert response.headers["x-atlas-usage-meter"] == "firehose_snapshot"
    assert response.headers["x-atlas-query-fingerprint"] == body["usage"]["query_fingerprint"]


@pytest.mark.asyncio
async def test_firehose_snapshot_content_location_preserves_full_query(
    test_client: object,
) -> None:
    """Canonical snapshot links should preserve every supported Firehose filter."""
    response = await test_client.get(
        "/api/firehose",
        params={
            "actor_type": "person",
            "cursor": "cursor_2",
            "issue": "housing",
            "limit": "10",
            "place": "detroit-mi",
            "signal_type": "public_meeting",
            "since": "2026-01-01T00:00:00Z",
            "sort": "occurred_at_desc",
            "source_class": "government",
            "until": "2026-02-01T00:00:00Z",
            "visibility": "public",
        },
        headers={"Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.headers["content-location"] == (
        "/api/firehose?place=detroit-mi&issue=housing&actor_type=person"
        "&signal_type=public_meeting&source_class=government&visibility=public"
        "&since=2026-01-01T00%3A00%3A00Z&until=2026-02-01T00%3A00%3A00Z"
        "&cursor=cursor_2&limit=10&sort=occurred_at_desc"
    )


@pytest.mark.asyncio
async def test_firehose_rejects_unsupported_representations(test_client: object) -> None:
    """Unsupported Accept values should fail with standard negotiation semantics."""
    response = await test_client.get(
        "/api/firehose",
        headers={"Accept": "text/csv"},
    )

    assert response.status_code == HTTPStatus.NOT_ACCEPTABLE
    assert response.headers["accept"] == SUPPORTED_FIREHOSE_REPRESENTATIONS
    assert response.json()["detail"] == "Firehose supports application/json and text/event-stream."


@pytest.mark.asyncio
async def test_firehose_snapshot_accepts_comma_delimited_filter_values(
    test_client: object,
) -> None:
    """The HTTP query surface should accept compact multi-value filters."""
    response = await test_client.get(
        "/api/firehose",
        params={
            "actor_type": "person,organization",
            "signal_type": "public_comment,new_source",
        },
        headers={"Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["query"]["actor_types"] == ["person", "organization"]
    assert body["query"]["signal_types"] == ["public_comment", "new_source"]


@pytest.mark.asyncio
async def test_firehose_snapshot_supports_conditional_polling(
    test_client: object,
) -> None:
    """Clients should be able to revalidate an unchanged Firehose query cheaply."""
    first = await test_client.get("/api/firehose", headers={"Accept": "application/json"})

    response = await test_client.get(
        "/api/firehose",
        headers={
            "Accept": "application/json",
            "If-None-Match": first.headers["etag"],
        },
    )

    assert response.status_code == HTTPStatus.NOT_MODIFIED
    assert response.content == b""
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_firehose_head_returns_snapshot_headers_without_body(test_client: object) -> None:
    """Clients should be able to probe Firehose freshness without downloading a page."""
    response = await test_client.head(
        "/api/firehose",
        params={"place": "las-vegas-nv", "issue": "housing"},
        headers={"Accept": "application/json", "X-Request-ID": "req_head"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.content == b""
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["etag"].startswith('"firehose-')
    assert response.headers["content-location"].startswith("/api/firehose?")
    assert response.headers["x-request-id"] == "req_head"
    assert response.headers["x-atlas-usage-meter"] == "firehose_snapshot"
    assert len(response.headers["x-atlas-query-fingerprint"]) == FINGERPRINT_LENGTH

    revalidated = await test_client.head(
        "/api/firehose",
        params={"place": "las-vegas-nv", "issue": "housing"},
        headers={
            "Accept": "application/json",
            "If-None-Match": response.headers["etag"],
        },
    )

    assert revalidated.status_code == HTTPStatus.NOT_MODIFIED
    assert revalidated.content == b""


@pytest.mark.asyncio
async def test_firehose_rejects_malformed_trace_headers(test_client: object) -> None:
    """Malformed W3C trace context should be a bad request, not ignored."""
    response = await test_client.get(
        "/api/firehose",
        headers={"Traceparent": "not-a-traceparent"},
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["detail"] == "Invalid traceparent header."


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("header_name", "header_value", "detail"),
    [
        ("X-Request-ID", "", "Invalid X-Request-ID header."),
        ("X-Request-ID", "req_\x00bad", "Invalid X-Request-ID header."),
        ("Tracestate", "", "Invalid tracestate header."),
        ("Tracestate", "atlas=\x00bad", "Invalid tracestate header."),
    ],
)
async def test_firehose_rejects_malformed_correlation_headers(
    test_client: object,
    header_name: str,
    header_value: str,
    detail: str,
) -> None:
    """Correlation headers should fail closed instead of entering logs or links."""
    response = await test_client.get(
        "/api/firehose",
        headers={header_name: header_value},
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["detail"] == detail


def test_firehose_http_context_accepts_default_headers() -> None:
    """Firehose clients may omit optional HTTP negotiation headers."""
    context = firehose_http._build_http_context(  # noqa: SLF001
        accept="",
        x_request_id=None,
        traceparent=None,
        tracestate=None,
        prefer=None,
    )

    assert context.representation == "json"
    assert context.request_id.startswith("req_")
    assert context.preferences.applied_header(include_return=True) is None


def test_firehose_http_context_prefers_event_stream_with_quality_params() -> None:
    """Accept negotiation should honor media ranges and q parameters."""
    context = firehose_http._build_http_context(  # noqa: SLF001
        accept=", , text/*; q=0.9; version=1, application/json; q=0.1; preview",
        x_request_id="req_quality",
        traceparent=None,
        tracestate=None,
        prefer=", return=representation",
    )

    assert context.representation == "sse"
    assert context.preferences.applied_header(include_return=True) == "return=representation"


def test_firehose_http_context_ignores_unknown_preferences() -> None:
    """Unknown Prefer tokens should not erase supported Firehose preferences."""
    context = firehose_http._build_http_context(  # noqa: SLF001
        accept="application/json",
        x_request_id="req_unknown_prefer",
        traceparent=None,
        tracestate=None,
        prefer="respond-async, wait=1",
    )

    assert context.preferences.applied_header(include_return=True) == "wait=1"


def test_firehose_http_context_rejects_bad_return_preference() -> None:
    """Malformed return preferences should not be silently ignored."""
    with pytest.raises(HTTPException) as exc_info:
        firehose_http._build_http_context(  # noqa: SLF001
            accept="application/json",
            x_request_id="req_bad_prefer",
            traceparent=None,
            tracestate=None,
            prefer="return=full",
        )

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST
    assert exc_info.value.detail == "Invalid Prefer header."


@pytest.mark.parametrize("accept", ["application/json; q=soon", "application/json; q=2"])
def test_firehose_http_context_rejects_bad_accept_quality(accept: str) -> None:
    """Malformed Accept quality values should fail closed."""
    with pytest.raises(HTTPException) as exc_info:
        firehose_http._build_http_context(  # noqa: SLF001
            accept=accept,
            x_request_id="req_bad_q",
            traceparent=None,
            tracestate=None,
            prefer=None,
        )

    assert exc_info.value.status_code == HTTPStatus.NOT_ACCEPTABLE


def test_firehose_json_http_context_accepts_missing_content_type() -> None:
    """JSON session clients may omit Content-Type when no body media type is present."""
    context = firehose_http._build_http_context(  # noqa: SLF001
        accept="application/json",
        x_request_id="req_json",
        traceparent=None,
        tracestate=None,
        prefer=None,
    )

    assert firehose_http.firehose_json_http_context(context, content_type=None) is context


@pytest.mark.asyncio
async def test_firehose_rejects_malformed_prefer_headers(test_client: object) -> None:
    """Malformed Prefer values should use a standard client-error response."""
    response = await test_client.get(
        "/api/firehose",
        headers={"Prefer": "wait=soon"},
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["detail"] == "Invalid Prefer header."


@pytest.mark.asyncio
async def test_firehose_uses_retry_after_for_unsupported_wait_windows(
    test_client: object,
) -> None:
    """Retry-After should appear with a standard temporary-unavailable response."""
    response = await test_client.get(
        "/api/firehose",
        headers={"Prefer": "wait=60"},
    )

    assert response.status_code == HTTPStatus.SERVICE_UNAVAILABLE
    assert response.headers["retry-after"] == "30"
    assert response.json()["detail"] == "Firehose wait preference exceeds the supported window."


@pytest.mark.asyncio
async def test_firehose_sse_uses_same_query_surface(test_client: object) -> None:
    """Requesting event-stream representation should observe the same Firehose query."""
    response = await test_client.get(
        "/api/firehose",
        params={"place": "las-vegas-nv", "issue": "housing"},
        headers={"Accept": "text/event-stream", "Last-Event-ID": "fhe_previous"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-store, no-transform"
    assert "event: firehose.ready" in response.text
    assert f"retry: {FIREHOSE_SSE_RETRY_MS}" in response.text
    assert '"last_event_id":"fhe_previous"' in response.text
    assert "event: heartbeat" in response.text


@pytest.mark.asyncio
async def test_firehose_sse_consumes_transport_headers(test_client: object) -> None:
    """SSE responses should carry correlation, preference, and buffering controls."""
    response = await test_client.get(
        "/api/firehose",
        headers={
            "Accept": "text/event-stream",
            "X-Request-ID": "req_sse",
            "Prefer": "wait=5",
        },
    )

    assert response.status_code == HTTPStatus.OK
    assert response.headers["x-request-id"] == "req_sse"
    assert response.headers["preference-applied"] == "wait=5"
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["ratelimit-limit"] == FIREHOSE_RATE_LIMIT
    assert response.headers["x-atlas-usage-meter"] == "firehose_stream"


@pytest.mark.asyncio
async def test_firehose_session_creation_rejects_unsupported_content_type(
    test_client: object,
) -> None:
    """Session creation should require JSON request bodies."""
    response = await test_client.post(
        "/api/firehose/sessions",
        content='{"query":{"places":["las-vegas-nv"]}}',
        headers={"Content-Type": "text/plain"},
    )

    assert response.status_code == HTTPStatus.UNSUPPORTED_MEDIA_TYPE
    assert response.headers["accept-post"] == "application/json"
    assert response.json()["detail"] == "Firehose sessions require application/json."


@pytest.mark.asyncio
async def test_firehose_session_creation_returns_durable_observation_links(
    test_client: object,
) -> None:
    """Complex observed queries should become durable Firehose sessions."""
    response = await test_client.post(
        "/api/firehose/sessions",
        headers={"Idempotency-Key": "same-query"},
        json={
            "query": {
                "places": ["las-vegas-nv"],
                "issues": ["housing", "transit"],
                "actor_types": ["organization", "person"],
                "signal_types": ["public_meeting", "new_source"],
                "visibility": "workspace",
            },
            "delivery": {"mode": "sse"},
        },
    )

    assert response.status_code == HTTPStatus.CREATED
    body = response.json()
    session_id = body["id"]
    assert response.headers["location"] == f"/api/firehose/sessions/{session_id}"
    assert body["state"] == "active"
    assert body["workspace"]["org_id"] == "local"
    assert body["usage"]["meter"] == "firehose_session"
    assert body["snapshot_url"] == f"/api/firehose/sessions/{session_id}"
    assert body["events_url"] == f"/api/firehose/sessions/{session_id}/events"
    assert body["socket_url"] == f"/api/firehose/sessions/{session_id}/socket"


@pytest.mark.asyncio
async def test_firehose_session_creation_consumes_minimal_preference(
    test_client: object,
) -> None:
    """Prefer: return=minimal should switch session creation to headers-only output."""
    response = await test_client.post(
        "/api/firehose/sessions",
        headers={
            "Idempotency-Key": "minimal-session",
            "Prefer": "return=minimal",
            "X-Request-ID": "req_minimal",
        },
        json={"query": {"places": ["las-vegas-nv"]}},
    )

    assert response.status_code == HTTPStatus.CREATED
    assert response.content == b""
    assert response.headers["location"].startswith("/api/firehose/sessions/fhs_")
    assert response.headers["preference-applied"] == "return=minimal"
    assert response.headers["x-request-id"] == "req_minimal"
    assert response.headers["x-atlas-usage-meter"] == "firehose_session"


@pytest.mark.asyncio
async def test_firehose_session_creation_consumes_idempotency_key(
    test_client: object,
) -> None:
    """Idempotency-Key should deterministically identify the same requested session."""
    first = await test_client.post(
        "/api/firehose/sessions",
        headers={"Idempotency-Key": "same-request"},
        json={"query": {"places": ["las-vegas-nv"]}},
    )
    second = await test_client.post(
        "/api/firehose/sessions",
        headers={"Idempotency-Key": "same-request"},
        json={"query": {"places": ["las-vegas-nv"]}},
    )

    assert first.status_code == HTTPStatus.CREATED
    assert second.status_code == HTTPStatus.CREATED
    assert first.headers["location"] == second.headers["location"]
    assert first.json()["id"] == second.json()["id"]


@pytest.mark.asyncio
async def test_firehose_session_snapshot_and_events_are_empty_but_typed(
    test_client: object,
) -> None:
    """Session reads should expose the same empty snapshot and live event contract."""
    snapshot = await test_client.get("/api/firehose/sessions/fhs_test")
    events = await test_client.get(
        "/api/firehose/sessions/fhs_test/events",
        headers={"Last-Event-ID": "fhe_prior"},
    )

    assert snapshot.status_code == HTTPStatus.OK
    assert snapshot.json()["session"]["id"] == "fhs_test"
    assert snapshot.json()["signals"] == []

    assert events.status_code == HTTPStatus.OK
    assert events.headers["content-type"].startswith("text/event-stream")
    assert "event: firehose.ready" in events.text
    assert '"session_id":"fhs_test"' in events.text
    assert '"last_event_id":"fhe_prior"' in events.text


@pytest.mark.asyncio
async def test_firehose_session_snapshot_supports_conditional_polling(
    test_client: object,
) -> None:
    """Durable session snapshots should use the same cheap revalidation path."""
    first = await test_client.get("/api/firehose/sessions/fhs_test")

    response = await test_client.get(
        "/api/firehose/sessions/fhs_test",
        headers={"If-None-Match": first.headers["etag"]},
    )

    assert response.status_code == HTTPStatus.NOT_MODIFIED
    assert response.content == b""
    assert response.headers["cache-control"] == "no-store"


def test_firehose_session_socket_emits_ready_event(test_settings: Settings) -> None:
    """The WebSocket stub should expose the future bidirectional session surface."""
    test_settings.deploy_mode = "local"
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: test_settings

    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/api/firehose/sessions/fhs_test/socket",
            subprotocols=[FIREHOSE_WEBSOCKET_PROTOCOL],
        ) as websocket,
    ):
        assert websocket.accepted_subprotocol == FIREHOSE_WEBSOCKET_PROTOCOL
        ready = websocket.receive_json()

    assert ready["type"] == "firehose.ready"
    assert ready["session_id"] == "fhs_test"
    assert ready["workspace"] == {
        "org_id": "local",
        "actor_id": "local-operator",
        "auth_type": "local",
        "api_key_id": None,
    }
    assert ready["usage"]["meter"] == "firehose_socket"
    assert len(ready["usage"]["query_fingerprint"]) == FINGERPRINT_LENGTH
    assert ready["query"]["limit"] == DEFAULT_FIREHOSE_LIMIT
    assert ready["last_event_id"] is None


def test_firehose_session_socket_rejects_unknown_subprotocol() -> None:
    """Firehose sockets should reject clients that request the wrong protocol."""
    websocket = _FakeWebSocket({"Sec-WebSocket-Protocol": "not-atlas-firehose"})

    with pytest.raises(WebSocketException) as exc_info:
        firehose_api._websocket_subprotocol(websocket)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


def test_firehose_session_socket_allows_missing_subprotocol() -> None:
    """Clients may connect without an explicit subprotocol."""
    websocket = _FakeWebSocket({})

    assert firehose_api._websocket_subprotocol(websocket) is None  # noqa: SLF001


@pytest.mark.asyncio
async def test_firehose_session_socket_accepts_internal_actor(test_settings: Settings) -> None:
    """Internal trusted callers should be able to consume workspace Firehose sockets."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    websocket = _FakeWebSocket(
        {
            "X-Atlas-Internal-Secret": "internal-test-secret",
            "X-Atlas-Actor-ID": "user_123",
            "X-Atlas-Actor-Email": "operator@example.com",
            "X-Atlas-Organization-ID": "org_123",
        }
    )

    actor = await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert actor.org_id == "org_123"
    assert actor.user_id == "user_123"
    assert actor.auth_type == "internal"
    assert actor.api_key_id is None


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_internal_actor_without_org(
    test_settings: Settings,
) -> None:
    """Trusted Firehose socket callers must still be scoped to an organization."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    websocket = _FakeWebSocket(
        {
            "X-Atlas-Internal-Secret": "internal-test-secret",
            "X-Atlas-Actor-ID": "user_123",
            "X-Atlas-Actor-Email": "operator@example.com",
        }
    )

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_session_socket_accepts_api_key_actor(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """API-key callers with Firehose read scope should be able to stream."""
    test_settings.deploy_mode = ""
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"firehose": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    monkeypatch.setattr("atlas.domains.firehose.api.verify_api_key", fake_verify_api_key)
    websocket = _FakeWebSocket({"X-API-Key": "atlas_test_key"})

    actor = await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert actor.org_id == "org_123"
    assert actor.user_id == "user_123"
    assert actor.auth_type == "api_key"
    assert actor.api_key_id == "key_123"


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_unknown_api_key(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Unknown API keys should not fall through to a workspace stream."""
    test_settings.deploy_mode = ""
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None

    monkeypatch.setattr("atlas.domains.firehose.api.verify_api_key", fake_verify_api_key)
    websocket = _FakeWebSocket({"X-API-Key": "atlas_test_key"})

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_api_key_without_org(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """API-key Firehose streams must be scoped to an organization."""
    test_settings.deploy_mode = ""
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"firehose": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id=None,
        )

    monkeypatch.setattr("atlas.domains.firehose.api.verify_api_key", fake_verify_api_key)
    websocket = _FakeWebSocket({"X-API-Key": "atlas_test_key"})

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_session_socket_accepts_oauth_jwt_actor(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """OAuth JWT callers with Firehose read permission should be able to stream."""
    test_settings.deploy_mode = ""
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]
    test_settings.auth_jwt_issuer = "https://atlas.example/auth"
    test_settings.auth_jwt_jwks_url = "https://atlas.example/auth/jwks"

    def fake_verify_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> dict[str, object] | None:
        assert authorization == "Bearer token_123"
        assert issuer == "https://atlas.example/auth"
        assert audience == ["https://atlas.example/api"]
        assert jwks_url == "https://atlas.example/auth/jwks"
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "org_id": "org_123",
            "permissions": {"firehose": ["read"]},
        }

    monkeypatch.setattr("atlas.domains.firehose.api.verify_bearer_jwt", fake_verify_bearer_jwt)
    websocket = _FakeWebSocket({"Authorization": "Bearer token_123"})

    actor = await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert actor.org_id == "org_123"
    assert actor.user_id == "user_123"
    assert actor.auth_type == "oauth_jwt"
    assert actor.api_key_id is None


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_oauth_jwt_without_org(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """OAuth Firehose streams must be scoped to an organization."""
    test_settings.deploy_mode = ""
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]
    test_settings.auth_jwt_issuer = "https://atlas.example/auth"
    test_settings.auth_jwt_jwks_url = "https://atlas.example/auth/jwks"

    def fake_verify_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> dict[str, object] | None:
        assert authorization == "Bearer token_123"
        assert issuer == "https://atlas.example/auth"
        assert audience == ["https://atlas.example/api"]
        assert jwks_url == "https://atlas.example/auth/jwks"
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "permissions": {"firehose": ["read"]},
        }

    monkeypatch.setattr("atlas.domains.firehose.api.verify_bearer_jwt", fake_verify_bearer_jwt)
    websocket = _FakeWebSocket({"Authorization": "Bearer token_123"})

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_requires_firehose_read_scope_for_api_keys(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
    test_db: object,
) -> None:
    """API keys need the Firehose read scope and are counted against their workspace."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"firehose": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.get(
        "/api/firehose",
        headers={"X-API-Key": "atlas_test_key", "Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.json()["workspace"] == {
        "org_id": "org_123",
        "actor_id": "user_123",
        "auth_type": "api_key",
        "api_key_id": "key_123",
    }
    assert await OrgUsageEventCRUD.count_by_type(test_db, org_id="org_123") == {"api_call": 1}


@pytest.mark.asyncio
async def test_firehose_rejects_api_keys_without_firehose_read_scope(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
    test_db: object,
) -> None:
    """A discovery API key should not read Firehose by accident."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.get(
        "/api/firehose",
        headers={"X-API-Key": "atlas_test_key", "Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert await OrgUsageEventCRUD.count_by_type(test_db, org_id="org_123") == {}


@pytest.mark.asyncio
async def test_firehose_requires_auth_when_auth_is_enabled(
    test_client: object,
    test_settings: Settings,
) -> None:
    """Firehose is not anonymous when Atlas auth is enabled."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]

    response = await test_client.get("/api/firehose", headers={"Accept": "application/json"})

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.headers["www-authenticate"].startswith("Bearer ")


@pytest.mark.asyncio
async def test_firehose_query_validation_rejects_invalid_limits(test_client: object) -> None:
    """Firehose query parameters should fail loudly when outside the contract."""
    response = await test_client.get("/api/firehose", params={"limit": "0"})

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


@pytest.mark.asyncio
async def test_firehose_openapi_declares_query_surface(test_client: object) -> None:
    """OpenAPI should document the Firehose snapshot and session entrypoints."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    assert payload["paths"]["/api/firehose"]["get"]["operationId"] == "getFirehose"
    assert payload["paths"]["/api/firehose"]["head"]["operationId"] == "headFirehose"
    assert (
        payload["paths"]["/api/firehose/sessions"]["post"]["operationId"] == "createFirehoseSession"
    )
    assert (
        payload["paths"]["/api/firehose/sessions/{session_id}"]["get"]["operationId"]
        == "getFirehoseSession"
    )
    declared_tags = {tag["name"] for tag in payload["tags"]}
    assert "firehose" in declared_tags
