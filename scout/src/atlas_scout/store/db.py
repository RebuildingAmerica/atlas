"""SQLite connection lifecycle for the Scout local store.

Owns opening/closing the database connection, its pragmas, and transient
write-lock retry. Schema creation is delegated to each repository,
orchestrated by the ScoutStore facade during initialize().
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import aiosqlite

from atlas_scout.sqlite_retry import run_sqlite_write

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

_SQLITE_BUSY_TIMEOUT_MS = 60000


class Database:
    """Async SQLite connection lifecycle, with no knowledge of table schemas."""

    def __init__(self, db_path: str) -> None:
        """Store the database path; call connect() before use."""
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    @property
    def connection(self) -> aiosqlite.Connection:
        """Return the open connection. Raises if connect() hasn't been called."""
        assert self._conn is not None, "Database.connect() must be called before use"
        return self._conn

    async def connect(self) -> None:
        """Open the database connection and set the per-connection busy timeout."""
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def commit(self) -> None:
        """Commit the current transaction."""
        await self.connection.commit()

    async def rollback_quietly(self) -> None:
        """Rollback the current transaction, ignoring rollback failures."""
        if self._conn is None:
            return
        try:
            await self._conn.rollback()
        except Exception:
            return

    async def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        """Execute a single write statement and commit, retrying transient locks."""

        async def operation() -> None:
            await self.connection.execute(sql, params)
            await self.connection.commit()

        await run_sqlite_write(operation, on_locked=self.rollback_quietly)

    async def executemany(self, sql: str, rows: list[tuple[Any, ...]]) -> int:
        """Execute many write rows and commit, retrying transient locks."""
        if not rows:
            return 0

        async def operation() -> int:
            cursor = await self.connection.executemany(sql, rows)
            await self.connection.commit()
            return max(cursor.rowcount, 0)

        return await run_sqlite_write(operation, on_locked=self.rollback_quietly)

    async def execute_count(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        """Execute a single write statement, commit, and return affected rows."""

        async def operation() -> int:
            cursor = await self.connection.execute(sql, params)
            await self.connection.commit()
            return max(cursor.rowcount, 0)

        return await run_sqlite_write(operation, on_locked=self.rollback_quietly)

    async def run_write[T](self, operation: Callable[[], Awaitable[T]]) -> T:
        """Run a caller-defined multi-statement write, retrying transient locks."""
        return await run_sqlite_write(operation, on_locked=self.rollback_quietly)

    async def list_tables(self) -> list[str]:
        """Return the names of all user tables in the database."""
        async with self.connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ) as cursor:
            rows = await cursor.fetchall()
        return [row["name"] for row in rows]
