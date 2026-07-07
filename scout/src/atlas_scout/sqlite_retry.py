"""SQLite retry helpers for transient local writer contention."""

from __future__ import annotations

import asyncio
import sqlite3
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

SQLITE_LOCK_RETRY_ATTEMPTS = 6
SQLITE_LOCK_RETRY_INITIAL_DELAY_SECONDS = 0.05
SQLITE_LOCK_RETRY_MAX_DELAY_SECONDS = 1.0


def is_sqlite_locked_error(exc: BaseException) -> bool:
    """Return whether an exception is SQLite's transient writer-lock signal."""
    if not isinstance(exc, sqlite3.OperationalError):
        return False
    message = str(exc).casefold()
    return "database is locked" in message or "database table is locked" in message


async def run_sqlite_write[T](
    operation: Callable[[], Awaitable[T]],
    *,
    on_locked: Callable[[], Awaitable[None]] | None = None,
    attempts: int = SQLITE_LOCK_RETRY_ATTEMPTS,
) -> T:
    """Run a SQLite write operation, retrying transient lock failures."""
    if attempts <= 0:
        raise ValueError("attempts must be positive")

    delay = SQLITE_LOCK_RETRY_INITIAL_DELAY_SECONDS
    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked_error(exc) or attempt == attempts:
                raise
            if on_locked is not None:
                await on_locked()
            await asyncio.sleep(delay)
            delay = min(delay * 2, SQLITE_LOCK_RETRY_MAX_DELAY_SECONDS)
    raise AssertionError("SQLite retry loop exhausted without returning or raising")
