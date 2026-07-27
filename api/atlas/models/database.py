"""
Database setup, schema management, and connection pooling.

Supports both SQLite (via aiosqlite) for local development and
PostgreSQL (via psycopg) for production deployments.
"""

from __future__ import annotations

import functools
import importlib.resources
import logging
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Protocol

import aiosqlite

from .database_migrations import (
    DatabaseManager,
    _ensure_discovery_job_columns,
    _ensure_discovery_run_columns,
    _ensure_entry_columns,
    _ensure_org_annotation_columns,
    _ensure_org_coverage_target_columns,
    _ensure_place_context_columns,
    _ensure_place_related_place_columns,
    _ensure_review_queue_columns,
    db,
    migrate_atproto_identity_graph,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

logger = logging.getLogger(__name__)

__all__ = ["DB_SCHEMA", "DatabaseManager", "db", "get_db_connection", "init_db"]


class CursorProtocol(Protocol):  # pragma: no cover - typing-only protocol
    """Protocol for database cursor objects."""

    @property
    def description(self) -> Any: ...
    @property
    def rowcount(self) -> int: ...
    async def fetchall(self) -> list[tuple[Any, ...]]: ...
    async def fetchone(self) -> tuple[Any, ...] | None: ...


class ConnectionProtocol(Protocol):  # pragma: no cover - typing-only protocol
    """Protocol for database connection objects."""

    async def execute(self, sql: str, parameters: Sequence[Any] = ()) -> CursorProtocol: ...
    async def executemany(
        self, sql: str, parameters: Sequence[Sequence[Any]]
    ) -> CursorProtocol: ...
    async def commit(self) -> None: ...
    async def close(self) -> None: ...


def _is_postgres_url(database_url: str) -> bool:
    return database_url.startswith(("postgresql://", "postgres://"))


def _get_sqlite_path(database_url: str) -> str:
    if database_url.startswith("sqlite:///"):
        return database_url[10:]
    if database_url.startswith("sqlite://"):
        return database_url[9:]
    return database_url


@functools.lru_cache(maxsize=256)
def _translate_placeholders(sql: str) -> str:
    """Translate ? placeholders to %s for psycopg."""
    result = []
    in_single_quote = False
    in_double_quote = False
    i = 0
    while i < len(sql):
        char = sql[i]
        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
            result.append(char)
        elif char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            result.append(char)
        elif char == "?" and not in_single_quote and not in_double_quote:
            result.append("%s")
        else:
            result.append(char)
        i += 1
    return "".join(result)


def _normalize_value(value: Any) -> Any:
    """Return a row value in the shape the rest of Atlas reads.

    psycopg hydrates timestamps and dates into ``datetime``/``date`` objects
    while aiosqlite returns the ISO strings that were stored. Every model,
    schema, and response builder in Atlas was written against the string shape,
    so a Postgres row arriving as objects fails validation deep inside a
    request — which is how row-shape divergences kept reaching production one
    table at a time.

    Normalizing here rather than at each call site is the same responsibility
    this adapter already takes for placeholder translation: one row shape,
    whichever backend produced it.

    Parameters
    ----------
    value
        A single column value from a psycopg row.

    Returns
    -------
    Any
        The value, with dates and timestamps rendered as ISO strings.
    """
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _normalize_row(row: tuple[Any, ...] | None) -> tuple[Any, ...] | None:
    """Normalize every column in a psycopg row.

    Parameters
    ----------
    row
        A psycopg row, or None when the cursor is exhausted.

    Returns
    -------
    tuple[Any, ...] | None
        The row with values normalized, or None.
    """
    if row is None:
        return None
    return tuple(_normalize_value(value) for value in row)


class PostgresCursor:
    """Adapter that wraps a psycopg AsyncCursor to match the aiosqlite cursor interface."""

    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    @property
    def description(self) -> Any:
        return self._cursor.description

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount  # type: ignore[no-any-return]

    async def fetchall(self) -> list[tuple[Any, ...]]:
        rows = await self._cursor.fetchall()
        return [normalized for row in rows if (normalized := _normalize_row(row)) is not None]

    async def fetchone(self) -> tuple[Any, ...] | None:
        return _normalize_row(await self._cursor.fetchone())


class PostgresConnection:
    """Adapter that wraps a psycopg AsyncConnection to match the aiosqlite interface."""

    backend = "postgres"

    def __init__(self, conn: Any) -> None:
        self._conn = conn

    async def execute(self, sql: str, parameters: Sequence[Any] = ()) -> PostgresCursor:
        translated = _translate_placeholders(sql)
        cursor = await self._conn.execute(translated, parameters or None)
        return PostgresCursor(cursor)

    async def executemany(self, sql: str, parameters: Sequence[Sequence[Any]]) -> PostgresCursor:
        translated = _translate_placeholders(sql)
        cursor = await self._conn.executemany(translated, parameters)
        return PostgresCursor(cursor)

    async def commit(self) -> None:
        await self._conn.commit()

    async def close(self) -> None:
        await self._conn.close()


async def get_db_connection(database_url: str, *, backend: str | None = None) -> Any:
    """
    Get an async database connection.

    Parameters
    ----------
    database_url : str
        Database URL.
    backend : str | None
        Explicit backend selection ("sqlite" or "postgres"). When None,
        falls back to URL-scheme detection for backwards compatibility
        with tests that don't pass a backend.

    Returns
    -------
    Connection adapter (PostgresConnection or aiosqlite.Connection)
    """
    use_postgres = backend == "postgres" if backend else _is_postgres_url(database_url)
    if use_postgres:
        import psycopg

        conn = await psycopg.AsyncConnection.connect(database_url, autocommit=False)
        return PostgresConnection(conn)

    db_path = _get_sqlite_path(database_url)
    sqlite_conn = await aiosqlite.connect(db_path)
    foreign_keys_cursor = await sqlite_conn.execute("PRAGMA foreign_keys = ON")
    await foreign_keys_cursor.close()
    journal_cursor = await sqlite_conn.execute("PRAGMA journal_mode = WAL")
    await journal_cursor.fetchone()
    await journal_cursor.close()
    return sqlite_conn


async def init_db(database_url: str, *, backend: str | None = None) -> None:
    """
    Initialize the database schema.

    Creates all tables and indexes if they don't exist. Safe to call
    multiple times (idempotent).

    Parameters
    ----------
    database_url : str
        Database URL.
    backend : str | None
        Explicit backend selection ("sqlite" or "postgres"). Falls back
        to URL-scheme detection when None.
    """
    use_postgres = backend == "postgres" if backend else _is_postgres_url(database_url)
    if use_postgres:
        await _init_postgres(database_url)
    else:
        await _init_sqlite(database_url)


async def _init_postgres(database_url: str) -> None:  # pragma: no cover - PG-only path
    """Initialize PostgreSQL schema."""
    import psycopg

    conn = await psycopg.AsyncConnection.connect(database_url, autocommit=False)
    try:
        await migrate_atproto_identity_graph(PostgresConnection(conn), backend="postgres")
        schema_sql = _load_postgres_schema()
        await conn.execute(schema_sql)
        await conn.commit()
        logger.info("PostgreSQL schema initialized successfully")
    except Exception:
        await conn.rollback()
        logger.exception("Failed to initialize PostgreSQL database")
        raise
    finally:
        await conn.close()


def _load_postgres_schema() -> str:
    """Load the PostgreSQL schema from the bundled SQL file."""
    return _load_sql_fragments("schema_parts")


async def _init_sqlite(database_url: str) -> None:
    """Initialize SQLite schema.

    Runs column migrations before the full schema script so that indexes
    and triggers referencing new columns don't fail on existing databases.
    """
    conn = await get_db_connection(database_url)
    try:
        await migrate_atproto_identity_graph(conn, backend="sqlite")
        await _ensure_entry_columns(conn)
        await _ensure_discovery_run_columns(conn)
        await _ensure_discovery_job_columns(conn)
        await _ensure_review_queue_columns(conn)
        await _ensure_org_annotation_columns(conn)
        await _ensure_org_coverage_target_columns(conn)
        await _ensure_place_context_columns(conn)
        await _ensure_place_related_place_columns(conn)
        await conn.commit()
        await conn.executescript(DB_SCHEMA)
        await conn.commit()
        logger.info("SQLite schema initialized successfully")
    except Exception:
        await conn.rollback()
        logger.exception("Failed to initialize SQLite database")
        raise
    finally:
        await conn.close()


# Full SQLite schema with FTS5 and proper indexes (kept for local development)
def _load_sqlite_schema() -> str:
    return _load_sql_fragments("sqlite_schema_parts")


def _load_sql_fragments(folder_name: str) -> str:
    """Concatenate ordered SQL fragments from a bundled directory."""
    parts_root = importlib.resources.files("atlas.models") / folder_name
    fragment_texts = [
        part.read_text(encoding="utf-8")
        for part in sorted(parts_root.iterdir(), key=lambda item: item.name)
        if part.name.endswith(".sql")
    ]
    if not fragment_texts:
        return parts_root.read_text(encoding="utf-8")
    return "\n".join(fragment_texts).rstrip() + "\n"


DB_SCHEMA = _load_sqlite_schema()
