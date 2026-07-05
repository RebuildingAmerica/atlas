"""Shared cursor pagination for MCP list-returning tools and tools/list.

Cursors are plain offsets. The MCP spec requires clients to treat them as
opaque, but says nothing about how servers must encode them, and an offset
is the simplest thing that satisfies "stable" and "handle invalid cursors
gracefully".
"""

from __future__ import annotations

__all__ = ["InvalidCursorError", "decode_cursor", "encode_cursor"]


class InvalidCursorError(ValueError):
    """Raised when a pagination cursor is present but not a valid offset."""

    def __init__(self, cursor: str) -> None:
        super().__init__(f"Invalid cursor: {cursor!r}")


def encode_cursor(offset: int) -> str:
    """Encode a page offset as a cursor string."""
    return str(offset)


def decode_cursor(cursor: str | None) -> int:
    """Decode a cursor string back to a non-negative page offset.

    Parameters
    ----------
    cursor : str | None
        The cursor from a paginated request, or None for the first page.

    Returns
    -------
    int
        The page offset. 0 when cursor is None.

    Raises
    ------
    InvalidCursorError
        If cursor is present but not a non-negative integer.
    """
    if cursor is None:
        return 0
    try:
        offset = int(cursor)
    except ValueError:
        raise InvalidCursorError(cursor) from None
    if offset < 0:
        raise InvalidCursorError(cursor)
    return offset
