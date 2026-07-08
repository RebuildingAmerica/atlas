"""Stats and maintenance helpers for the article frontier repository."""

from __future__ import annotations

from typing import Any

from atlas_scout.store._util import now


class ArticleFrontierMaintenanceMixin:
    """Status updates, releases, and frontier stats for article crawl rows."""

    async def mark_article_frontier_fetched(self, urls: list[str]) -> None:
        """Mark article frontier URLs as fetched."""
        await self._mark_article_frontier_urls(urls, status="fetched")

    async def mark_article_frontier_skipped(self, urls: list[str]) -> None:
        """Mark article frontier URLs as skipped because they no longer need fetching."""
        await self._mark_article_frontier_urls(urls, status="skipped")

    async def release_article_frontier_claims(self, urls: list[str], *, worker_id: str) -> int:
        """Release unfinished article frontier leases owned by one worker."""
        if not urls:
            return 0
        updated_at = now()
        updated = 0
        rows = [(updated_at, url, worker_id) for url in urls]
        for start in range(0, len(rows), 5000):
            updated += await self._db.executemany(
                """
                UPDATE article_frontier
                SET claimed_by = NULL,
                    claimed_at = NULL,
                    claim_expires_at = NULL,
                    updated_at = ?
                WHERE url = ?
                  AND status = 'pending'
                  AND claimed_by = ?
                """,
                rows[start : start + 5000],
            )
        return updated

    async def release_article_frontier_claims_by_worker(self, *, worker_id: str) -> int:
        """Release all unfinished article frontier leases owned by one worker."""
        if not worker_id:
            raise ValueError("worker_id must be non-empty")
        return await self._db.execute_count(
            """
            UPDATE article_frontier
            SET claimed_by = NULL,
                claimed_at = NULL,
                claim_expires_at = NULL,
                updated_at = ?
            WHERE status = 'pending'
              AND claimed_by = ?
            """,
            (now(), worker_id),
        )

    async def _mark_article_frontier_urls(self, urls: list[str], *, status: str) -> None:
        """Update the status for a collection of persisted frontier URLs."""
        if status not in {"fetched", "skipped"}:
            raise ValueError("status must be fetched or skipped")
        if not urls:
            return
        updated_at = now()
        rows = [
            (status, updated_at if status == "fetched" else None, updated_at, url) for url in urls
        ]
        await self._db.executemany(
            """
            UPDATE article_frontier
            SET status = ?,
                fetched_at = COALESCE(?, fetched_at),
                claimed_by = NULL,
                claimed_at = NULL,
                claim_expires_at = NULL,
                updated_at = ?
            WHERE url = ?
            """,
            rows,
        )

    async def article_frontier_stats(self) -> dict[str, Any]:
        """Return pending/fetched/skipped article frontier counts."""
        stats: dict[str, Any] = {
            "pending": 0,
            "fetched": 0,
            "skipped": 0,
            "claimed": 0,
            "by_source_domain": {},
        }
        async with self._db.connection.execute(
            "SELECT status, COUNT(*) AS count FROM article_frontier GROUP BY status"
        ) as cursor:
            rows = await cursor.fetchall()
        for row in rows:
            status = str(row["status"])
            if status in {"pending", "fetched", "skipped"}:
                stats[status] = int(row["count"])

        async with self._db.connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM article_frontier
            WHERE status = 'pending'
              AND claim_expires_at > ?
            """,
            (now(),),
        ) as cursor:
            claim_count_row = await cursor.fetchone()
        stats["claimed"] = int(claim_count_row["count"]) if claim_count_row is not None else 0

        async with self._db.connection.execute(
            """
            SELECT source_domain, COUNT(*) AS count
            FROM article_frontier
            WHERE status = 'pending'
            GROUP BY source_domain
            ORDER BY count DESC, source_domain ASC
            """
        ) as cursor:
            rows = await cursor.fetchall()
        stats["by_source_domain"] = {str(row["source_domain"]): int(row["count"]) for row in rows}
        return stats
