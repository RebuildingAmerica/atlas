"""Structured request logging for the Atlas API.

Atlas had no error reporting of any kind, and its logs were plain text with
no request identity. A five-week outage went unnoticed partly because the
only monitor watched a page that could not fail; the other half of that
problem is that when something does break, nothing says what.

Cloud Run parses JSON on stdout and lifts ``severity`` into the log level and
``message`` into the summary line, so emitting JSON here turns unstructured
text into queryable records without adding a vendor or a DSN.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import time
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable

    from starlette.types import ASGIApp, Message, Receive, Scope, Send

__all__ = [
    "REQUEST_ID_HEADER",
    "JsonLogFormatter",
    "RequestLogMiddleware",
    "configure_json_logging",
    "current_request_id",
    "request_id_var",
]

REQUEST_ID_HEADER = "X-Request-Id"
"""Header Atlas reads an inbound request id from, and always echoes back."""

_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}\Z")
"""Shape a caller-supplied id must match to be echoed back and logged.

The 128 cap matches MAX_REQUEST_ID_LENGTH in atlas.domains.firehose.http so a
Firehose request and a request log line cannot end up describing the same
request with two different ids. Validating with a compiled pattern rather than
a per-character loop keeps a 128-character header off the hot path.
"""

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("atlas_request_id", default="")

# Attributes LogRecord always carries. Anything else was attached by a caller
# via `extra=` and belongs in the JSON payload.
_STANDARD_RECORD_FIELDS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "asctime",
    "message",
    "taskName",
}


_LOGGER = logging.getLogger("atlas.request")
"""Resolved once: getLogger takes a lock, and this name never changes."""


def current_request_id() -> str:
    """Return the request id bound to this task, or an empty string."""
    return request_id_var.get()


class JsonLogFormatter(logging.Formatter):
    """Render log records as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialize *record*, folding in any `extra=` fields and the request id.

        Parameters
        ----------
        record : logging.LogRecord
            The record to render.

        Returns
        -------
        str
            A single-line JSON object.
        """
        payload: dict[str, Any] = {
            # Cloud Run reads these two names specifically.
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
        }

        request_id = current_request_id()
        if request_id:
            payload["request_id"] = request_id

        payload.update(
            {
                key: value
                for key, value in record.__dict__.items()
                if key not in _STANDARD_RECORD_FIELDS and not key.startswith("_")
            }
        )

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure_json_logging(level: int = logging.INFO) -> None:
    """Send the root logger to stdout as JSON.

    Replaces handlers rather than adding one, so repeated calls in tests and
    reloads do not multiply every line.

    Parameters
    ----------
    level : int
        Root log level.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level)
    _defer_uvicorn_logging_to_root()


def _defer_uvicorn_logging_to_root() -> None:
    """Stop uvicorn from emitting its own plain-text lines beside ours.

    Uvicorn installs handlers on ``uvicorn`` and ``uvicorn.access`` with
    ``propagate`` off, so the JSON handler on root never sees those records and
    Cloud Run gets two formats interleaved. Clearing the handlers and letting
    the records propagate gives every line one shape.

    ``uvicorn.access`` stays silent rather than propagating: RequestLogMiddleware
    already emits a line per request carrying the method, path, status, duration
    and request id, and uvicorn's version of it repeats a strict subset.
    """
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = name != "uvicorn.access"


def _resolve_request_id(raw: str | None) -> str:
    """Return a safe request id, preferring the caller's when it is usable.

    Callers control this header, so an id is echoed back only when it cannot
    forge structure in a log line or a downstream header. Anything else is
    replaced rather than rejected: a malformed id is not worth failing a
    request over, and the generated one still correlates the log lines.
    """
    if raw and _REQUEST_ID_PATTERN.match(raw.strip()):
        return raw.strip()
    return uuid.uuid4().hex


class RequestLogMiddleware:
    """Bind a request id, echo it back, and emit one structured line per request.

    Pure ASGI rather than a BaseHTTPMiddleware dispatch function. Starlette's
    BaseHTTPMiddleware runs the downstream app in a child task and relays every
    response chunk through a memory object stream; that turns each SSE frame
    from the Firehose and the mounted MCP transport into a queue hop and keeps
    the middleware task alive for the life of the stream. Wrapping ``send``
    costs nothing per chunk and leaves streaming responses untouched.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Wrap one ASGI call, logging it unless it is a lifespan or websocket."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _resolve_request_id(_header_value(scope, REQUEST_ID_HEADER))
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_holder = {"status": 0}

        header_name = REQUEST_ID_HEADER.lower().encode()

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message["status"])
                # Replace rather than append. The Firehose routes echo this
                # header themselves, and appending gave those responses two
                # X-Request-Id values that HTTP joins with a comma, which no
                # client parses back into an id. The middleware's id wins so the
                # header always names the request the log line describes.
                headers = [
                    (key, value)
                    for key, value in (message.get("headers") or [])
                    if key.lower() != header_name
                ]
                headers.append((header_name, request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            _LOGGER.exception("Request failed", extra=_request_fields(scope, started))
            raise
        else:
            _LOGGER.info(
                "Request completed",
                extra={**_request_fields(scope, started), "http_status": status_holder["status"]},
            )
        finally:
            request_id_var.reset(token)


def _header_value(scope: Scope, name: str) -> str | None:
    """Return one request header from a raw ASGI scope, or None."""
    wanted = name.lower().encode()
    headers: Iterable[tuple[bytes, bytes]] = scope.get("headers") or []
    for key, value in headers:
        if key == wanted:
            return value.decode("latin-1")
    return None


def _request_fields(scope: Scope, started: float) -> dict[str, Any]:
    """Return the fields both the success and failure log lines share."""
    return {
        "http_method": scope.get("method", ""),
        "http_path": scope.get("path", ""),
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
    }
