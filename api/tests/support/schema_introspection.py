"""Portable schema introspection for tests.

Schema-shape assertions are worth running against both backends — production
runs PostgreSQL, and a column that exists only in the SQLite schema is exactly
the kind of divergence that reaches readers. ``PRAGMA`` is SQLite-only, so these
helpers ask each backend the same question in its own dialect.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def _is_postgres(conn: Any) -> bool:
    """Return whether a connection speaks PostgreSQL.

    Parameters
    ----------
    conn
        An open database connection.

    Returns
    -------
    bool
        True when the connection is the PostgreSQL adapter.
    """
    return getattr(conn, "backend", "sqlite") == "postgres"


async def table_columns(conn: Any, table: str) -> set[str]:
    """Return the column names of a table.

    Parameters
    ----------
    conn
        An open database connection.
    table
        Table name to introspect.

    Returns
    -------
    set[str]
        Every column name defined on the table.
    """
    if _is_postgres(conn):
        cursor = await conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
            (table,),
        )
        return {row[0] for row in await cursor.fetchall()}

    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


@asynccontextmanager
async def with_foreign_keys_disabled(conn: Any, table: str) -> AsyncIterator[None]:
    """Temporarily stop a table from enforcing its foreign keys.

    ``PRAGMA foreign_keys`` is connection-wide and SQLite-only; PostgreSQL
    enforces foreign keys through per-table triggers, so the portable
    equivalent disables them on just the one table under test.

    Parameters
    ----------
    conn
        An open database connection.
    table
        Table whose foreign keys should stop being enforced for the
        duration of the ``async with`` block.
    """
    if _is_postgres(conn):
        await conn.execute(f"ALTER TABLE {table} DISABLE TRIGGER ALL")
    else:
        await conn.execute("PRAGMA foreign_keys = OFF")
    try:
        yield
    finally:
        if _is_postgres(conn):
            await conn.execute(f"ALTER TABLE {table} ENABLE TRIGGER ALL")
        else:
            await conn.execute("PRAGMA foreign_keys = ON")


async def table_exists(conn: Any, table: str) -> bool:
    """Return whether a table exists.

    Parameters
    ----------
    conn
        An open database connection.
    table
        Table name to look for.

    Returns
    -------
    bool
        True when the table is present.
    """
    if _is_postgres(conn):
        cursor = await conn.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ?",
            (table,),
        )
    else:
        cursor = await conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        )
    return await cursor.fetchone() is not None
