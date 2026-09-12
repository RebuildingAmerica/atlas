"""Ask a live database what columns a table actually has."""

from __future__ import annotations

from typing import Any


async def _table_columns(conn: Any, table: str, *, backend: str) -> set[str]:
    if backend == "postgres":
        cursor = await conn.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = ?
            """,
            (table,),
        )
        return {str(row[0]) for row in await cursor.fetchall()}
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in await cursor.fetchall()}
