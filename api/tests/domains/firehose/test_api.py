"""Firehose query surface contract tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.firehose import http as firehose_http

FINGERPRINT_LENGTH = 64
FIREHOSE_VARY = "Accept, Authorization, X-API-Key, Prefer, Last-Event-ID, Accept-Encoding"
FIREHOSE_RATE_LIMIT = "600;w=60"
FIREHOSE_RATE_LIMIT_REMAINING = "600"
FIREHOSE_RATE_LIMIT_RESET = "60"
FIREHOSE_SSE_RETRY_MS = 3000
SUPPORTED_FIREHOSE_REPRESENTATIONS = "application/json, text/event-stream"
VALID_TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


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
