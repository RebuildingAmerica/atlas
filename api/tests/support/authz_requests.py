"""Minimal requests for calling authorization guards directly in tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.requests import Request

if TYPE_CHECKING:
    from starlette.types import Message


def guard_request(
    method: str = "GET",
    path: str = "/",
    path_params: dict[str, str] | None = None,
    *,
    body: bytes = b"",
    content_type: str | None = None,
) -> Request:
    """Build a bare request a guard can read its method, path and path parameters from.

    Parameters
    ----------
    method : str
        HTTP method. Safe methods are never written to the audit log.
    path : str
        Request path, used as the route when no route template is attached.
    path_params : dict[str, str] | None
        Path parameters recorded as the audit target.
    body : bytes
        Request body, where a change states its reason.
    content_type : str | None
        Content-Type header, or None to send no headers.

    Returns
    -------
    Request
        A Starlette request carrying only what was given.
    """

    async def receive() -> Message:
        return {"type": "http.request", "body": body, "more_body": False}

    headers = [] if content_type is None else [(b"content-type", content_type.encode())]
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": headers,
            "path_params": path_params or {},
            "query_string": b"",
        },
        receive,
    )
