"""Local SQLite store for Atlas Scout: runs, page cache, and entries."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import aiosqlite

_CREATE_RUNS = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    location TEXT NOT NULL,
    issues TEXT NOT NULL,
    search_depth TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    queries INTEGER,
    pages_fetched INTEGER,
    entries_found INTEGER,
    entries_after_dedup INTEGER,
    error TEXT,
    created_at TEXT NOT NULL
)
"""

_CREATE_PAGES = """
CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT,
    fetched_at TEXT NOT NULL
)
"""

_CREATE_ENTRIES = """
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    state TEXT,
    score REAL NOT NULL DEFAULT 0.0,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
)
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class ScoutStore:
    """Async SQLite store for Scout's local state."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """Open the database connection and create tables if needed."""
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute(_CREATE_RUNS)
        await self._conn.execute(_CREATE_PAGES)
        await self._conn.execute(_CREATE_ENTRIES)
        await self._conn.commit()

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
        await self._conn.execute(sql, params)
        await self._conn.commit()

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    async def create_run(
        self,
        *,
        location: str,
        issues: list[str],
        search_depth: str,
    ) -> str:
        """Insert a new run record and return its ID."""
        run_id = _new_id()
        await self._execute(
            """
            INSERT INTO runs (id, location, issues, search_depth, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
            """,
            (run_id, location, json.dumps(issues), search_depth, _now()),
        )
        return run_id

    async def get_run(self, run_id: str) -> dict[str, Any]:
        """Fetch a run by ID. Raises KeyError if not found."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM runs WHERE id = ?", (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"Run not found: {run_id}")
        return dict(row)

    async def update_run_status(self, run_id: str, status: str) -> None:
        """Update only the status field of a run."""
        await self._execute(
            "UPDATE runs SET status = ? WHERE id = ?",
            (status, run_id),
        )

    async def complete_run(
        self,
        run_id: str,
        *,
        queries: int,
        pages_fetched: int,
        entries_found: int,
        entries_after_dedup: int,
    ) -> None:
        """Mark a run as completed and record its final statistics."""
        await self._execute(
            """
            UPDATE runs
            SET status = 'completed',
                completed_at = ?,
                queries = ?,
                pages_fetched = ?,
                entries_found = ?,
                entries_after_dedup = ?
            WHERE id = ?
            """,
            (_now(), queries, pages_fetched, entries_found, entries_after_dedup, run_id),
        )

    async def fail_run(self, run_id: str, error: str) -> None:
        """Mark a run as failed and record the error message."""
        await self._execute(
            """
            UPDATE runs
            SET status = 'failed',
                completed_at = ?,
                error = ?
            WHERE id = ?
            """,
            (_now(), error, run_id),
        )

    async def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return the most recent runs, newest first."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    # ------------------------------------------------------------------
    # Page cache
    # ------------------------------------------------------------------

    async def get_cached_page(
        self, url: str, ttl_days: int = 7
    ) -> dict[str, Any] | None:
        """Return a cached page if it exists and is within TTL, else None."""
        assert self._conn is not None
        async with self._conn.execute(
            f"SELECT * FROM pages WHERE url = ? AND fetched_at > datetime('now', '-{ttl_days} days')",
            (url,),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["metadata"] = json.loads(result["metadata"])
        return result

    async def cache_page(
        self, url: str, text: str, metadata: dict[str, Any]
    ) -> None:
        """Insert or replace a page in the cache."""
        await self._execute(
            """
            INSERT OR REPLACE INTO pages (url, text, metadata, fetched_at)
            VALUES (?, ?, ?, ?)
            """,
            (url, text, json.dumps(metadata), _now()),
        )

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------

    async def save_entry(
        self,
        *,
        run_id: str,
        name: str,
        entry_type: str,
        description: str,
        city: str | None,
        state: str | None,
        score: float,
        data: dict[str, Any],
    ) -> str:
        """Insert an entry and return its ID."""
        entry_id = _new_id()
        await self._execute(
            """
            INSERT INTO entries
                (id, run_id, name, entry_type, description, city, state, score, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                run_id,
                name,
                entry_type,
                description,
                city,
                state,
                score,
                json.dumps(data),
                _now(),
            ),
        )
        return entry_id

    async def list_entries(
        self,
        run_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Return entries, optionally filtered by run and minimum score."""
        assert self._conn is not None
        if run_id is not None:
            sql = "SELECT * FROM entries WHERE run_id = ? AND score >= ? ORDER BY score DESC"
            params: tuple[Any, ...] = (run_id, min_score)
        else:
            sql = "SELECT * FROM entries WHERE score >= ? ORDER BY score DESC"
            params = (min_score,)

        async with self._conn.execute(sql, params) as cursor:
            rows = await cursor.fetchall()

        results = []
        for row in rows:
            entry = dict(row)
            entry["data"] = json.loads(entry["data"])
            results.append(entry)
        return results
