"""LLM extraction result cache, keyed by page fingerprint + provider + prompt."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import now

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_EXTRACTIONS = """
CREATE TABLE IF NOT EXISTS extractions (
    cache_key TEXT PRIMARY KEY,
    source_fingerprint TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    prompt_key TEXT NOT NULL,
    entries TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
)
"""


class ExtractionCacheRepository:
    """Caches LLM extraction results to avoid redundant provider calls."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create the extractions table if it doesn't exist."""
        await self._db.connection.execute(_CREATE_EXTRACTIONS)

    async def get_cached_extraction(self, cache_key: str) -> dict[str, Any] | None:
        """Return a cached extraction result if present."""
        async with self._db.connection.execute(
            "SELECT * FROM extractions WHERE cache_key = ?",
            (cache_key,),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["entries"] = json.loads(result["entries"])
        return result

    async def cache_extraction(
        self,
        *,
        cache_key: str,
        source_fingerprint: str,
        provider_key: str,
        prompt_key: str,
        entries: list[dict[str, Any]],
    ) -> None:
        """Insert or replace a structured extraction result."""
        await self._db.execute(
            """
            INSERT OR REPLACE INTO extractions
                (cache_key, source_fingerprint, provider_key, prompt_key, entries, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                cache_key,
                source_fingerprint,
                provider_key,
                prompt_key,
                json.dumps(entries),
                now(),
            ),
        )
