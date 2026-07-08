"""Firehose HTTP context and session contract tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.firehose import http as firehose_http

FIREHOSE_RATE_LIMIT = "600;w=60"
FIREHOSE_SSE_RETRY_MS = 3000


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
