"""MCP logging capability: structured operation notifications.

Registers ``logging/setLevel`` (which auto-advertises the ``logging``
capability, since the lowlevel Server's own capability builder checks for
that handler's presence) and exposes ``log_operation``, a best-effort helper
every custom request handler in ``tasks.py`` calls to notify the client
about the operation it just ran.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from mcp.server.lowlevel.server import request_ctx

if TYPE_CHECKING:
    from mcp import types
    from mcp.server.fastmcp import FastMCP
    from mcp.server.session import ServerSession

__all__ = [
    "current_min_level",
    "current_session",
    "install_logging_extension",
    "log_operation",
]

_stdlib_logger = logging.getLogger(__name__)

_LEVEL_ORDER: dict[types.LoggingLevel, int] = {
    "debug": 0,
    "info": 1,
    "notice": 2,
    "warning": 3,
    "error": 4,
    "critical": 5,
    "alert": 6,
    "emergency": 7,
}

_min_log_level: types.LoggingLevel = "info"
"""Process-global minimum level. Atlas's MCP server is stateless HTTP with no
per-client session state, so one operator-visible level for the whole process
is the simplest thing that satisfies the spec here, at the cost of one
client's logging/setLevel call affecting every other concurrent client."""


async def _handle_set_level(level: types.LoggingLevel) -> None:
    global _min_log_level  # noqa: PLW0603
    _min_log_level = level


def current_min_level() -> types.LoggingLevel:
    """Return the current process-wide minimum log level."""
    return _min_log_level


def current_session() -> ServerSession | None:
    """Return the active MCP session, or None outside a request context."""
    try:
        return request_ctx.get().session
    except LookupError:
        return None


async def log_operation(
    *, logger: str, level: types.LoggingLevel, message: str, **data: Any
) -> None:
    """Send a best-effort structured ``notifications/message``. Never raises.

    Does nothing below the client's configured minimum level, or outside an
    active request (there is no session to notify).
    """
    if _LEVEL_ORDER[level] < _LEVEL_ORDER[current_min_level()]:
        return

    session = current_session()
    if session is None:
        return

    try:
        await session.send_log_message(
            level=level, data={"message": message, **data}, logger=logger
        )
    except Exception:
        _stdlib_logger.exception("Failed to send MCP log notification.")


def install_logging_extension(mcp: FastMCP) -> None:
    """Wire the MCP logging capability onto a FastMCP server instance."""
    server = mcp._mcp_server  # noqa: SLF001
    server.set_logging_level()(_handle_set_level)  # type: ignore[no-untyped-call]
