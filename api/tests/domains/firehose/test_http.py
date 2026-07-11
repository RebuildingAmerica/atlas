"""Tests for Firehose HTTP header negotiation."""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Response

from atlas.domains.firehose.http import (
    FirehoseHttpPreferences,
    FirehoseResponseHeaderContext,
    _accept_quality,
    _build_http_context,
    _negotiate_representation,
    _parse_prefer,
    _validate_request_id,
    _validate_traceparent,
    _validate_tracestate,
    apply_http_context_headers,
)


def test_firehose_preferences_emit_representation_ack() -> None:
    preferences = FirehoseHttpPreferences(wait_seconds=5, return_representation=True)

    assert preferences.applied_header(include_return=True) == "wait=5, return=representation"
    assert preferences.applied_header(include_return=False) == "wait=5"


def test_firehose_context_generates_request_id_and_accepts_wildcards() -> None:
    context = _build_http_context(
        accept="text/*;q=0.9, application/json;q=0.1,",
        x_request_id=None,
        traceparent=None,
        tracestate="vendor=value",
        prefer=", wait=10, return=representation",
    )

    assert context.representation == "sse"
    assert context.request_id.startswith("req_")
    assert context.tracestate == "vendor=value"
    assert context.preferences.wait_seconds == 10
    assert context.preferences.return_representation is True
    assert _negotiate_representation("*/*") == "json"
    assert _accept_quality("application/json;q=0.25", "application/json") == 0.25
    assert _accept_quality("", "application/json") == 1.0
    assert _accept_quality("application/json; foo", "application/json") == 1.0
    assert _accept_quality(" , application/json; charset=utf-8", "application/json") == 1.0
    assert _parse_prefer("wait=1, respond-async").wait_seconds == 1


@pytest.mark.parametrize(
    ("header", "detail"),
    [
        ("", "Invalid X-Request-ID header."),
        ("bad\x7frequest", "Invalid X-Request-ID header."),
    ],
)
def test_firehose_request_id_rejects_invalid_values(header: str, detail: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _validate_request_id(header)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == detail


@pytest.mark.parametrize(
    "traceparent",
    [
        "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
        "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
    ],
)
def test_firehose_traceparent_rejects_invalid_ids(traceparent: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _validate_traceparent(traceparent)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid traceparent header."


def test_firehose_tracestate_and_prefer_reject_malformed_values() -> None:
    with pytest.raises(HTTPException) as tracestate_error:
        _validate_tracestate("bad\nstate")
    assert tracestate_error.value.status_code == 400
    assert tracestate_error.value.detail == "Invalid tracestate header."

    with pytest.raises(HTTPException) as prefer_error:
        _parse_prefer("return=verbose")
    assert prefer_error.value.status_code == 400
    assert prefer_error.value.detail == "Invalid Prefer header."

    with pytest.raises(HTTPException) as unacceptable_error:
        _negotiate_representation("application/json;q=bad")
    assert unacceptable_error.value.status_code == 406


def test_firehose_response_headers_preserve_trace_context() -> None:
    response = Response()
    context = _build_http_context(
        accept="application/json",
        x_request_id="req_known",
        traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate="vendor=value",
        prefer="return=minimal",
    )

    apply_http_context_headers(
        response,
        header_context=FirehoseResponseHeaderContext(
            request=context,
            workspace_id="org_1",
            usage_meter="firehose",
            query_fingerprint="fingerprint",
            content_location="/api/firehose/observations",
            preference_applied=context.preferences.applied_header(include_return=True),
        ),
    )

    assert response.headers["Traceparent"] == context.traceparent
    assert response.headers["Tracestate"] == "vendor=value"
    assert response.headers["Preference-Applied"] == "return=minimal"
