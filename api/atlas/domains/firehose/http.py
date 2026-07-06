"""HTTP header dependencies for the Firehose API surface."""

from __future__ import annotations

import re
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, Header, HTTPException, Response, status
from pydantic import BaseModel

FIREHOSE_RATE_LIMIT = "600;w=60"
FIREHOSE_RATE_LIMIT_REMAINING = "600"
FIREHOSE_RATE_LIMIT_RESET = "60"
FIREHOSE_SSE_RETRY_MS = 3000
FIREHOSE_WEBSOCKET_PROTOCOL = "atlas.firehose.v1"
FIREHOSE_VARY = "Accept, Authorization, X-API-Key, Prefer, Last-Event-ID, Accept-Encoding"
SUPPORTED_FIREHOSE_POST_MEDIA_TYPE = "application/json"
SUPPORTED_FIREHOSE_REPRESENTATIONS = "application/json, text/event-stream"
MAX_PREFER_WAIT_SECONDS = 30
MAX_REQUEST_ID_LENGTH = 128
MAX_TRACESTATE_LENGTH = 512
ASCII_CONTROL_LIMIT = 32
ASCII_DELETE = 127
INVALID_PREFER_HEADER = "Invalid Prefer header."
INVALID_REQUEST_ID_HEADER = "Invalid X-Request-ID header."
INVALID_TRACEPARENT_HEADER = "Invalid traceparent header."
INVALID_TRACESTATE_HEADER = "Invalid tracestate header."
PREFER_WAIT_UNAVAILABLE_DETAIL = "Firehose wait preference exceeds the supported window."
UNACCEPTABLE_REPRESENTATION_DETAIL = "Firehose supports application/json and text/event-stream."
UNSUPPORTED_SESSION_CONTENT_TYPE_DETAIL = "Firehose sessions require application/json."
TRACEPARENT_PATTERN = re.compile(
    r"^(?P<version>[0-9a-f]{2})-"
    r"(?P<trace_id>[0-9a-f]{32})-"
    r"(?P<parent_id>[0-9a-f]{16})-"
    r"(?P<trace_flags>[0-9a-f]{2})$"
)


class FirehoseHttpPreferences(BaseModel):
    """Parsed HTTP preferences for one Firehose request."""

    wait_seconds: int | None = None
    return_minimal: bool = False
    return_representation: bool = False

    def applied_header(self, *, include_return: bool) -> str | None:
        """Return the Preference-Applied header for preferences this route honored."""
        values: list[str] = []
        if self.wait_seconds is not None:
            values.append(f"wait={self.wait_seconds}")
        if include_return and self.return_minimal:
            values.append("return=minimal")
        if include_return and self.return_representation:
            values.append("return=representation")
        return ", ".join(values) if values else None


class FirehoseHttpContext(BaseModel):
    """Validated request header context consumed by Firehose routes."""

    representation: Literal["json", "sse"]
    request_id: str
    traceparent: str | None = None
    tracestate: str | None = None
    preferences: FirehoseHttpPreferences


class FirehoseResponseHeaderContext(BaseModel):
    """Response header context derived from a consumed Firehose request."""

    request: FirehoseHttpContext
    workspace_id: str
    usage_meter: str
    query_fingerprint: str
    content_location: str
    preference_applied: str | None = None


def _bad_header(detail: str) -> HTTPException:
    """Return a standard bad-request exception for malformed request headers."""
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _not_acceptable() -> HTTPException:
    """Return a standard not-acceptable response for unsupported representations."""
    return HTTPException(
        status_code=status.HTTP_406_NOT_ACCEPTABLE,
        detail=UNACCEPTABLE_REPRESENTATION_DETAIL,
        headers={"Accept": SUPPORTED_FIREHOSE_REPRESENTATIONS},
    )


def _unsupported_session_media_type() -> HTTPException:
    """Return a standard media-type response for non-JSON session bodies."""
    return HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail=UNSUPPORTED_SESSION_CONTENT_TYPE_DETAIL,
        headers={"Accept-Post": SUPPORTED_FIREHOSE_POST_MEDIA_TYPE},
    )


def _unsupported_wait_window() -> HTTPException:
    """Return the standard retry response for a wait window Firehose cannot honor yet."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=PREFER_WAIT_UNAVAILABLE_DETAIL,
        headers={"Retry-After": str(MAX_PREFER_WAIT_SECONDS)},
    )


def _contains_control_character(value: str) -> bool:
    """Return whether a header value includes a disallowed control character."""
    return any(
        ord(character) < ASCII_CONTROL_LIMIT or ord(character) == ASCII_DELETE
        for character in value
    )


def _validate_request_id(value: str | None) -> str:
    """Return a caller request id or generate one when omitted."""
    if value is None:
        return f"req_{uuid4().hex}"
    request_id = value.strip()
    if (
        not request_id
        or len(request_id) > MAX_REQUEST_ID_LENGTH
        or _contains_control_character(request_id)
    ):
        raise _bad_header(INVALID_REQUEST_ID_HEADER)
    return request_id


def _validate_traceparent(value: str | None) -> str | None:
    """Validate and return a W3C traceparent header."""
    if value is None:
        return None
    traceparent = value.strip()
    match = TRACEPARENT_PATTERN.match(traceparent)
    if (
        match is None
        or match.group("version") == "ff"
        or match.group("trace_id") == "0" * 32
        or match.group("parent_id") == "0" * 16
    ):
        raise _bad_header(INVALID_TRACEPARENT_HEADER)
    return traceparent


def _validate_tracestate(value: str | None) -> str | None:
    """Validate and return a W3C tracestate header enough for safe propagation."""
    if value is None:
        return None
    tracestate = value.strip()
    if (
        not tracestate
        or len(tracestate) > MAX_TRACESTATE_LENGTH
        or _contains_control_character(tracestate)
    ):
        raise _bad_header(INVALID_TRACESTATE_HEADER)
    return tracestate


def _parse_prefer(value: str | None) -> FirehoseHttpPreferences:
    """Parse the RFC 7240 Prefer header values Firehose can honor."""
    preferences = FirehoseHttpPreferences()
    if value is None:
        return preferences

    for raw_item in value.split(","):
        item = raw_item.strip()
        if not item:
            continue
        name, separator, raw_preference_value = item.partition("=")
        preference_name = name.strip().lower()
        preference_value = raw_preference_value.strip().lower()
        if preference_name == "wait":
            if separator != "=" or not preference_value.isdigit():
                raise _bad_header(INVALID_PREFER_HEADER)
            wait_seconds = int(preference_value)
            if wait_seconds > MAX_PREFER_WAIT_SECONDS:
                raise _unsupported_wait_window()
            preferences.wait_seconds = wait_seconds
            continue
        if preference_name == "return":
            if separator != "=" or preference_value not in {"minimal", "representation"}:
                raise _bad_header(INVALID_PREFER_HEADER)
            preferences.return_minimal = preference_value == "minimal"
            preferences.return_representation = preference_value == "representation"

    return preferences


def _parse_quality(value: str | None) -> float:
    """Parse an HTTP q value, failing closed on malformed values."""
    if value is None:
        return 1.0
    try:
        quality = float(value)
    except ValueError as exc:
        raise _not_acceptable() from exc
    if quality < 0 or quality > 1:
        raise _not_acceptable()
    return quality


def _media_type_matches(candidate: str, supported: str) -> bool:
    """Return whether one Accept media range matches a supported media type."""
    candidate_type, _, candidate_subtype = candidate.partition("/")
    supported_type, _, supported_subtype = supported.partition("/")
    if candidate == "*/*":
        return True
    if candidate_subtype == "*" and candidate_type == supported_type:
        return True
    return candidate_type == supported_type and candidate_subtype == supported_subtype


def _accept_quality(accept: str | None, supported: str) -> float:
    """Return the best q value for one supported media type."""
    if accept is None or not accept.strip():
        return 1.0
    quality = 0.0
    for raw_item in accept.split(","):
        parts = [part.strip() for part in raw_item.split(";") if part.strip()]
        if not parts:
            continue
        media_range = parts[0].lower()
        params: dict[str, str] = {}
        for raw_param in parts[1:]:
            name, separator, raw_value = raw_param.partition("=")
            if separator == "=":
                params[name.strip().lower()] = raw_value.strip()
        if _media_type_matches(media_range, supported):
            quality = max(quality, _parse_quality(params.get("q")))
    return quality


def _negotiate_representation(accept: str | None) -> Literal["json", "sse"]:
    """Negotiate the Firehose response representation from Accept."""
    json_quality = _accept_quality(accept, "application/json")
    sse_quality = _accept_quality(accept, "text/event-stream")
    if json_quality == 0 and sse_quality == 0:
        raise _not_acceptable()
    if sse_quality > json_quality:
        return "sse"
    return "json"


def _validate_json_content_type(content_type: str | None) -> None:
    """Validate JSON Content-Type for request bodies."""
    if content_type is None:
        return
    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type != SUPPORTED_FIREHOSE_POST_MEDIA_TYPE:
        raise _unsupported_session_media_type()


def _build_http_context(
    *,
    accept: str | None,
    x_request_id: str | None,
    traceparent: str | None,
    tracestate: str | None,
    prefer: str | None,
) -> FirehoseHttpContext:
    """Build the shared Firehose HTTP context from request headers."""
    return FirehoseHttpContext(
        representation=_negotiate_representation(accept),
        request_id=_validate_request_id(x_request_id),
        traceparent=_validate_traceparent(traceparent),
        tracestate=_validate_tracestate(tracestate),
        preferences=_parse_prefer(prefer),
    )


def firehose_http_context(
    accept: Annotated[str | None, Header(alias="Accept")] = None,
    x_request_id: Annotated[str | None, Header(alias="X-Request-ID")] = None,
    traceparent: Annotated[str | None, Header(alias="Traceparent")] = None,
    tracestate: Annotated[str | None, Header(alias="Tracestate")] = None,
    prefer: Annotated[str | None, Header(alias="Prefer")] = None,
) -> FirehoseHttpContext:
    """Build the Firehose HTTP context from request headers."""
    return _build_http_context(
        accept=accept,
        x_request_id=x_request_id,
        traceparent=traceparent,
        tracestate=tracestate,
        prefer=prefer,
    )


def firehose_json_http_context(
    base_context: Annotated[FirehoseHttpContext, Depends(firehose_http_context)],
    content_type: Annotated[str | None, Header(alias="Content-Type")] = None,
) -> FirehoseHttpContext:
    """Build a Firehose HTTP context for JSON request-body routes."""
    _validate_json_content_type(content_type)
    return base_context


def apply_http_context_headers(
    response: Response,
    *,
    header_context: FirehoseResponseHeaderContext,
) -> None:
    """Apply standard Firehose response headers derived from request context."""
    response.headers["X-Request-ID"] = header_context.request.request_id
    if header_context.request.traceparent is not None:
        response.headers["Traceparent"] = header_context.request.traceparent
    if header_context.request.tracestate is not None:
        response.headers["Tracestate"] = header_context.request.tracestate
    if header_context.preference_applied:
        response.headers["Preference-Applied"] = header_context.preference_applied
    response.headers["RateLimit-Limit"] = FIREHOSE_RATE_LIMIT
    response.headers["RateLimit-Remaining"] = FIREHOSE_RATE_LIMIT_REMAINING
    response.headers["RateLimit-Reset"] = FIREHOSE_RATE_LIMIT_RESET
    response.headers["Server-Timing"] = "auth;dur=0, firehose;dur=0"
    response.headers["Content-Location"] = header_context.content_location
    response.headers["X-Atlas-Workspace-ID"] = header_context.workspace_id
    response.headers["X-Atlas-Usage-Meter"] = header_context.usage_meter
    response.headers["X-Atlas-Query-Fingerprint"] = header_context.query_fingerprint
