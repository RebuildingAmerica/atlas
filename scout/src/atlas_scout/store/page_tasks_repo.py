"""Per-URL page task tracking within a run."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import new_id, now

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_PAGE_TASKS = """
CREATE TABLE IF NOT EXISTS page_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    entries_extracted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

_CREATE_PAGE_TASKS_RUN_URL_INDEX = """
CREATE INDEX IF NOT EXISTS idx_page_tasks_run_url
ON page_tasks(run_id, url)
"""

_CREATE_PAGE_TASKS_RUN_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_page_tasks_run_status
ON page_tasks(run_id, status)
"""


class PageTasksRepository:
    """Tracks the per-URL fetch/extract task lifecycle within a run."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create the page_tasks table and its indexes if they don't exist."""
        await self._db.connection.execute(_CREATE_PAGE_TASKS)
        await self._db.connection.execute(_CREATE_PAGE_TASKS_RUN_URL_INDEX)
        await self._db.connection.execute(_CREATE_PAGE_TASKS_RUN_STATUS_INDEX)

    async def create_page_task(self, run_id: str, url: str) -> str:
        """Create a page task in queued status and return its ID."""
        task_id = new_id()
        created_at = now()
        await self._db.execute(
            """
            INSERT INTO page_tasks (id, run_id, url, status, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?)
            """,
            (task_id, run_id, url, created_at, created_at),
        )
        return task_id

    async def update_page_task(
        self,
        task_id: str,
        status: str,
        *,
        error: str | None = None,
        entries_extracted: int | None = None,
    ) -> None:
        """Update a page task status and optional result fields."""
        parts = ["status = ?", "updated_at = ?"]
        params: list[Any] = [status, now()]
        if error is not None:
            parts.append("error = ?")
            params.append(error)
        if entries_extracted is not None:
            parts.append("entries_extracted = ?")
            params.append(entries_extracted)
        params.append(task_id)
        await self._db.execute(
            f"UPDATE page_tasks SET {', '.join(parts)} WHERE id = ?",
            tuple(params),
        )

    async def list_page_tasks(self, run_id: str) -> list[dict[str, Any]]:
        """Return page tasks for one run ordered by creation time."""
        async with self._db.connection.execute(
            "SELECT * FROM page_tasks WHERE run_id = ? ORDER BY created_at",
            (run_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def list_all_page_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent page tasks across all runs."""
        async with self._db.connection.execute(
            "SELECT * FROM page_tasks ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_page_task_summary(self, run_id: str) -> dict[str, int]:
        """Return counts of page tasks by status for a run."""
        async with self._db.connection.execute(
            "SELECT status, COUNT(*) AS cnt FROM page_tasks WHERE run_id = ? GROUP BY status",
            (run_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        return {row["status"]: row["cnt"] for row in rows}
