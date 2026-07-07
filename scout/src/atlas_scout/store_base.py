"""Base store plumbing for Atlas Scout."""

from __future__ import annotations

from typing import Any

import aiosqlite

from atlas_scout.sqlite_retry import run_sqlite_write
from atlas_scout.store_core import (
    _CREATE_ARTICLE_FRONTIER,
    _CREATE_ARTICLE_FRONTIER_CLAIM_INDEX,
    _CREATE_ARTICLE_FRONTIER_DOMAIN_INDEX,
    _CREATE_ARTICLE_FRONTIER_STATUS_INDEX,
    _CREATE_ARTICLES,
    _CREATE_ARTICLES_PUBLISHED_INDEX,
    _CREATE_ARTICLES_SOURCE_INDEX,
    _CREATE_DAEMON_STATE,
    _CREATE_ENTRIES,
    _CREATE_EXTRACTIONS,
    _CREATE_PAGE_TASKS,
    _CREATE_PAGE_TASKS_RUN_STATUS_INDEX,
    _CREATE_PAGE_TASKS_RUN_URL_INDEX,
    _CREATE_PAGES,
    _CREATE_RUN_ARTIFACTS,
    _CREATE_RUNS,
    _CREATE_WORK_CLAIMS,
    _DAEMON_STATE_KEY,
    _SQLITE_BUSY_TIMEOUT_MS,
    _now,
)


class ScoutStoreBase:
    """Async SQLite store for Scout's local state."""

    def __init__(self, db_path: str) -> None:
        """Store the database path; call initialize() before use."""
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self, *, create_schema: bool = True) -> None:
        """Open the database connection and create tables if needed."""
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")
        if not create_schema:
            return

        async def operation() -> None:
            assert self._conn is not None
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute(_CREATE_RUNS)
            await self._conn.execute(_CREATE_PAGES)
            await self._conn.execute(_CREATE_PAGE_TASKS)
            await self._conn.execute(_CREATE_ENTRIES)
            await self._conn.execute(_CREATE_ARTICLES)
            await self._ensure_article_frontier_table()
            await self._conn.execute(_CREATE_EXTRACTIONS)
            await self._conn.execute(_CREATE_RUN_ARTIFACTS)
            await self._conn.execute(_CREATE_WORK_CLAIMS)
            await self._ensure_daemon_state_table()
            await self._conn.execute(_CREATE_PAGE_TASKS_RUN_URL_INDEX)
            await self._conn.execute(_CREATE_PAGE_TASKS_RUN_STATUS_INDEX)
            await self._conn.execute(_CREATE_ARTICLES_PUBLISHED_INDEX)
            await self._conn.execute(_CREATE_ARTICLES_SOURCE_INDEX)
            await self._conn.execute(_CREATE_ARTICLE_FRONTIER_STATUS_INDEX)
            await self._conn.execute(_CREATE_ARTICLE_FRONTIER_DOMAIN_INDEX)
            await self._conn.execute(_CREATE_ARTICLE_FRONTIER_CLAIM_INDEX)
            await self._conn.execute(
                """
                INSERT INTO daemon_state (key, status, target_count, updated_at)
                VALUES (?, 'stopped', 0, ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (_DAEMON_STATE_KEY, _now()),
            )
            await self._conn.commit()

        await run_sqlite_write(operation, on_locked=self._rollback_quietly)

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def list_tables(self) -> list[str]:
        """Return the names of all user tables in the database."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ) as cursor:
            rows = await cursor.fetchall()
        return [row["name"] for row in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        """Execute a single statement and commit."""
        assert self._conn is not None

        async def operation() -> None:
            assert self._conn is not None
            await self._conn.execute(sql, params)
            await self._conn.commit()

        await run_sqlite_write(operation, on_locked=self._rollback_quietly)

    async def _executemany(self, sql: str, rows: list[tuple[Any, ...]]) -> int:
        """Execute many write rows and commit with transient lock retry."""
        if not rows:
            return 0
        assert self._conn is not None

        async def operation() -> int:
            assert self._conn is not None
            cursor = await self._conn.executemany(sql, rows)
            await self._conn.commit()
            return max(cursor.rowcount, 0)

        return await run_sqlite_write(operation, on_locked=self._rollback_quietly)

    async def _execute_count(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        """Execute a single write statement and return affected rows."""
        assert self._conn is not None

        async def operation() -> int:
            assert self._conn is not None
            cursor = await self._conn.execute(sql, params)
            await self._conn.commit()
            return max(cursor.rowcount, 0)

        return await run_sqlite_write(operation, on_locked=self._rollback_quietly)

    async def _rollback_quietly(self) -> None:
        """Rollback the current transaction, ignoring rollback failures."""
        if self._conn is None:
            return
        try:
            await self._conn.rollback()
        except Exception:
            return

    async def _ensure_daemon_state_table(self) -> None:
        """Create or migrate the daemon_state table to enforce current constraints."""
        assert self._conn is not None
        await self._conn.execute(_CREATE_DAEMON_STATE)
        async with self._conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'daemon_state'"
        ) as cursor:
            row = await cursor.fetchone()

        schema_sql = str(row["sql"]) if row is not None else ""
        if "target_count >= 0" not in schema_sql or "'starting'" not in schema_sql:
            await self._conn.execute("ALTER TABLE daemon_state RENAME TO daemon_state_legacy")
            await self._conn.execute(_CREATE_DAEMON_STATE)
            await self._conn.execute(
                """
                INSERT INTO daemon_state (
                    key,
                    status,
                    started_at,
                    last_heartbeat_at,
                    config_path,
                    profile_name,
                    process_id,
                    target_count,
                    interval_seconds,
                    interval_basis,
                    last_tick_summary,
                    updated_at
                )
                SELECT
                    key,
                    status,
                    started_at,
                    last_heartbeat_at,
                    config_path,
                    profile_name,
                    NULL,
                    CASE
                        WHEN target_count < 0 THEN 0
                        ELSE target_count
                    END,
                    NULL,
                    NULL,
                    last_tick_summary,
                    updated_at
                FROM daemon_state_legacy
                """
            )
            await self._conn.execute("DROP TABLE daemon_state_legacy")

        async with self._conn.execute("PRAGMA table_info(daemon_state)") as cursor:
            rows = await cursor.fetchall()
        existing_columns = {str(row["name"]) for row in rows}

        migration_sql: list[str] = []
        if "process_id" not in existing_columns:
            migration_sql.append("ALTER TABLE daemon_state ADD COLUMN process_id INTEGER")
        if "interval_seconds" not in existing_columns:
            migration_sql.append("ALTER TABLE daemon_state ADD COLUMN interval_seconds INTEGER")
        if "interval_basis" not in existing_columns:
            migration_sql.append("ALTER TABLE daemon_state ADD COLUMN interval_basis TEXT")

        for statement in migration_sql:
            await self._conn.execute(statement)

    async def _ensure_article_frontier_table(self) -> None:
        """Create or migrate the article frontier table for durable crawl leases."""
        assert self._conn is not None
        await self._conn.execute(_CREATE_ARTICLE_FRONTIER)
        async with self._conn.execute("PRAGMA table_info(article_frontier)") as cursor:
            rows = await cursor.fetchall()
        columns = {str(row["name"]) for row in rows}
        migrations = {
            "claimed_by": "ALTER TABLE article_frontier ADD COLUMN claimed_by TEXT",
            "claimed_at": "ALTER TABLE article_frontier ADD COLUMN claimed_at TEXT",
            "claim_expires_at": "ALTER TABLE article_frontier ADD COLUMN claim_expires_at TEXT",
        }
        for column, sql in migrations.items():
            if column not in columns:
                await self._conn.execute(sql)

    # ------------------------------------------------------------------
    # Daemon state
    # ------------------------------------------------------------------
