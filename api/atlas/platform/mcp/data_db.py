"""Database session helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.models import get_db_connection

if TYPE_CHECKING:
    from aiosqlite import Connection


class DatabaseSession:
    """Small async context manager for SQLite connections."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._conn: Connection | None = None

    async def __aenter__(self) -> Connection:
        self._conn = await get_db_connection(self._database_url)
        return self._conn

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._conn is not None:
            await self._conn.close()
