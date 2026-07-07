"""Durable article-to-entry extraction progress for Scout runs."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import now

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_ARTICLE_EXTRACTIONS = """
CREATE TABLE IF NOT EXISTS article_extractions (
    article_url TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    prompt_key TEXT NOT NULL,
    status TEXT NOT NULL,
    owner_run_id TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    entries_extracted INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (article_url, provider_key, prompt_key)
)
"""

_CREATE_ARTICLE_EXTRACTIONS_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_extractions_status
ON article_extractions(status, lease_expires_at)
"""


class ArticleExtractionRepository:
    """Tracks which article rows have already been processed into entries."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create the article extraction progress table."""
        await self._db.connection.execute(_CREATE_ARTICLE_EXTRACTIONS)
        await self._db.connection.execute(_CREATE_ARTICLE_EXTRACTIONS_STATUS_INDEX)

    async def claim_article_extraction_batch(
        self,
        *,
        owner_run_id: str,
        provider_key: str,
        prompt_key: str,
        limit: int,
        lease_seconds: int = 600,
        retry_failed: bool = False,
    ) -> list[dict[str, Any]]:
        """Claim unprocessed article rows for the active run."""
        if limit <= 0:
            return []

        current_time = datetime.now(UTC)
        now_iso = current_time.isoformat()
        lease_expires_at = (current_time + timedelta(seconds=lease_seconds)).isoformat()
        failed_filter = "OR ae.status = 'failed'" if retry_failed else ""

        async def operation() -> list[dict[str, Any]]:
            conn = self._db.connection
            await conn.execute("BEGIN IMMEDIATE")
            try:
                async with conn.execute(
                    f"""
                    SELECT a.*
                    FROM articles a
                    LEFT JOIN article_extractions ae
                      ON ae.article_url = a.url
                     AND ae.provider_key = ?
                     AND ae.prompt_key = ?
                    WHERE ae.article_url IS NULL
                       OR ae.status = 'pending'
                       {failed_filter}
                       OR (ae.status = 'inflight' AND ae.lease_expires_at <= ?)
                    ORDER BY a.published_at DESC, a.url ASC
                    LIMIT ?
                    """,
                    (provider_key, prompt_key, now_iso, limit),
                ) as cursor:
                    rows = await cursor.fetchall()

                article_rows = [_article_record(row) for row in rows]
                if not article_rows:
                    await conn.commit()
                    return []

                await conn.executemany(
                    """
                    INSERT INTO article_extractions (
                        article_url,
                        provider_key,
                        prompt_key,
                        status,
                        owner_run_id,
                        lease_expires_at,
                        entries_extracted,
                        error,
                        updated_at
                    ) VALUES (?, ?, ?, 'inflight', ?, ?, 0, NULL, ?)
                    ON CONFLICT(article_url, provider_key, prompt_key) DO UPDATE SET
                        status = 'inflight',
                        owner_run_id = excluded.owner_run_id,
                        lease_expires_at = excluded.lease_expires_at,
                        error = NULL,
                        updated_at = excluded.updated_at
                    """,
                    [
                        (
                            str(row["url"]),
                            provider_key,
                            prompt_key,
                            owner_run_id,
                            lease_expires_at,
                            now_iso,
                        )
                        for row in article_rows
                    ],
                )
                await conn.commit()
            except Exception:
                await self._db.rollback_quietly()
                raise
            return article_rows

        return await self._db.run_write(operation)

    async def complete_article_extraction(
        self,
        *,
        article_url: str,
        provider_key: str,
        prompt_key: str,
        entries_extracted: int,
    ) -> None:
        """Mark one article as processed for this provider/prompt pair."""
        await self._db.execute(
            """
            UPDATE article_extractions
            SET status = 'completed',
                lease_expires_at = ?,
                entries_extracted = ?,
                error = NULL,
                updated_at = ?
            WHERE article_url = ?
              AND provider_key = ?
              AND prompt_key = ?
            """,
            (
                now(),
                entries_extracted,
                now(),
                article_url,
                provider_key,
                prompt_key,
            ),
        )

    async def fail_article_extraction(
        self,
        *,
        article_url: str,
        provider_key: str,
        prompt_key: str,
        error: str,
    ) -> None:
        """Mark one article extraction attempt as failed."""
        await self._db.execute(
            """
            UPDATE article_extractions
            SET status = 'failed',
                lease_expires_at = ?,
                error = ?,
                updated_at = ?
            WHERE article_url = ?
              AND provider_key = ?
              AND prompt_key = ?
            """,
            (now(), error, now(), article_url, provider_key, prompt_key),
        )


def _article_record(row: Any) -> dict[str, Any]:
    record = dict(row)
    metadata = json.loads(record["metadata"])
    record["metadata"] = metadata if isinstance(metadata, dict) else {}
    return record
