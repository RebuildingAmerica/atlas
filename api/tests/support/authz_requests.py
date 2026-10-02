"""Minimal requests for calling authorization guards directly in tests."""

from __future__ import annotations

from starlette.requests import Request


def guard_request(
    method: str = "GET",
    path: str = "/",
    path_params: dict[str, str] | None = None,
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

    Returns
    -------
    Request
        A Starlette request with no headers or body.
    """
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [],
            "path_params": path_params or {},
            "query_string": b"",
        }
    )
