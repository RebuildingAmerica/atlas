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
import time
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi import Request, Response

__all__ = [
    "REQUEST_ID_HEADER",
    "JsonLogFormatter",
    "configure_json_logging",
    "current_request_id",
    "log_requests",
    "request_id_var",
]

REQUEST_ID_HEADER = "X-Request-Id"
"""Header Atlas reads an inbound request id from, and always echoes back."""

_MAX_INBOUND_REQUEST_ID = 200
"""Cap on a caller-supplied id so it cannot bloat every log line."""

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("atlas_request_id", default="")

# Attributes LogRecord always carries. Anything else was attached by a caller
# via `extra=` and belongs in the JSON payload.
_STANDARD_RECORD_FIELDS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "asctime",
    "message",
    "taskName",
}


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


def _resolve_request_id(raw: str | None) -> str:
    """Return a safe request id, preferring the caller's when it is usable."""
    if raw:
        cleaned = raw.strip()[:_MAX_INBOUND_REQUEST_ID]
        # Callers control this header, so keep it to characters that cannot
        # forge structure in a log line or a downstream header.
        if cleaned and all(c.isalnum() or c in "-_." for c in cleaned):
            return cleaned
    return uuid.uuid4().hex


async def log_requests(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Bind a request id, emit one structured line per request, echo the id.

    A failing request logs at error with the exception attached, so an
    outage produces a queryable record naming the route rather than a bare
    stack trace with no path.

    Parameters
    ----------
    request : Request
        Inbound request.
    call_next : Callable
        The next handler in the middleware chain.

    Returns
    -------
    Response
        The downstream response, carrying the request id header.
    """
    request_id = _resolve_request_id(request.headers.get(REQUEST_ID_HEADER))
    token = request_id_var.set(request_id)
    logger = logging.getLogger("atlas.request")
    started = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Request failed",
            extra={
                "http_method": request.method,
                "http_path": request.url.path,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise
    finally:
        request_id_var.reset(token)

    response.headers[REQUEST_ID_HEADER] = request_id
    logger.info(
        "Request completed",
        extra={
            "http_method": request.method,
            "http_path": request.url.path,
            "http_status": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "request_id": request_id,
        },
    )
    return response
