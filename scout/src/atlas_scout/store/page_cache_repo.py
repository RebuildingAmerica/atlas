"""Fetched-page cache: content, metadata, and content-hash tracking."""

from __future__ import annotations

import json
from hashlib import sha256
from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import now

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_PAGES = """
CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT,
    fetched_at TEXT NOT NULL
)
"""


class PageCacheRepository:
    """Persists fetched page content for reuse across runs."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create the pages table if it doesn't exist."""
        await self._db.connection.execute(_CREATE_PAGES)

    async def get_cached_page(self, url: str, ttl_days: int | None = 7) -> dict[str, Any] | None:
        """Return a cached page if it exists and is within TTL, else None."""
        sql = "SELECT * FROM pages WHERE url = ?"
        params: tuple[Any, ...] = (url,)
        if ttl_days is not None:
            sql += f" AND fetched_at > datetime('now', '-{ttl_days} days')"
        async with self._db.connection.execute(sql, params) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["metadata"] = json.loads(result["metadata"])
        return result

    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None:
        """Insert or replace a page in the cache."""
        content_hash = sha256(text.encode("utf-8")).hexdigest()
        await self._db.execute(
            """
            INSERT OR REPLACE INTO pages (url, text, metadata, content_hash, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (url, text, json.dumps(metadata), content_hash, now()),
        )

    async def list_pages(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return cached pages ordered by most recent fetch time."""
        async with self._db.connection.execute(
            "SELECT * FROM pages ORDER BY fetched_at DESC LIMIT ?",
            (limit,),
        ) as cursor:
            rows = await cursor.fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"])
            results.append(item)
        return results
