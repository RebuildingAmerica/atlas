"""Article frontier persistence mixin for Atlas Scout."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from atlas_scout.sqlite_retry import run_sqlite_write
from atlas_scout.store_core import _now


class ScoutStoreArticleFrontierMixin:
    async def upsert_article_frontier(
        self,
        items: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
    ) -> dict[str, int]:
        """Persist newly discovered article frontier URLs for resumable crawls."""
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")

        assert self._conn is not None
        seen_urls: set[str] = set()
        candidate_rows: list[tuple[str, str, int, int, str, str, str]] = []
        now = _now()
        skipped = 0
        for item in items:
            url = str(item.get("url") or "").strip()
            if not url or url in seen_urls:
                skipped += 1
                continue
            seen_urls.add(url)
            seed_url = str(item.get("seed_url") or url)
            depth = int(item.get("depth") or 0)
            priority = int(item.get("priority") or 0)
            source_domain = str(item.get("source_domain") or urlparse(url).netloc.lower())
            candidate_rows.append((url, seed_url, depth, priority, source_domain, now, now))

        if not candidate_rows:
            return {"attempted": len(items), "saved": 0, "skipped": skipped}

        existing_urls = await self._existing_frontier_urls([row[0] for row in candidate_rows])
        insert_rows = [row for row in candidate_rows if row[0] not in existing_urls]
        skipped += len(candidate_rows) - len(insert_rows)
        for start in range(0, len(insert_rows), batch_size):
            await self._executemany(
                """
                INSERT INTO article_frontier
                    (
                        url,
                        seed_url,
                        depth,
                        priority,
                        source_domain,
                        discovered_at,
                        updated_at
                    )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                insert_rows[start : start + batch_size],
            )

        return {
            "attempted": len(items),
            "saved": len(insert_rows),
            "skipped": skipped,
        }

    async def _existing_frontier_urls(self, urls: list[str]) -> set[str]:
        """Return URLs that are already in the persisted article frontier."""
        assert self._conn is not None
        existing: set[str] = set()
        for start in range(0, len(urls), 900):
            chunk = urls[start : start + 900]
            placeholders = ", ".join("?" for _ in chunk)
            async with self._conn.execute(
                f"SELECT url FROM article_frontier WHERE url IN ({placeholders})",
                tuple(chunk),
            ) as cursor:
                rows = await cursor.fetchall()
            existing.update(str(row["url"]) for row in rows)
        return existing

    async def claim_article_frontier_batch(
        self,
        *,
        limit: int,
        max_per_domain: int,
        blocked_domains: set[str],
        existing_article_urls: set[str],
        worker_id: str | None = None,
        lease_seconds: int = 900,
    ) -> list[dict[str, Any]]:
        """Lease pending article frontier URLs, balanced by domain."""
        if limit <= 0:
            return []
        if max_per_domain <= 0:
            raise ValueError("max_per_domain must be positive")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")

        assert self._conn is not None
        owner = worker_id or f"article-frontier-{uuid.uuid4().hex}"
        now = datetime.now(UTC)
        now_iso = now.isoformat()
        lease_expires_at = (now + timedelta(seconds=lease_seconds)).isoformat()
        scan_limit = max(limit * 100, limit)

        async def operation() -> list[dict[str, Any]]:
            assert self._conn is not None
            await self._conn.execute("BEGIN IMMEDIATE")
            try:
                async with self._conn.execute(
                    """
                    SELECT *
                    FROM article_frontier
                    WHERE status = 'pending'
                      AND (claim_expires_at IS NULL OR claim_expires_at <= ?)
                    ORDER BY priority DESC, discovered_at ASC, url ASC
                    LIMIT ?
                    """,
                    (now_iso, scan_limit),
                ) as cursor:
                    rows = await cursor.fetchall()

                domain_queues: dict[str, list[dict[str, Any]]] = {}
                domain_order: list[str] = []
                skipped_existing: list[str] = []
                for row in rows:
                    url = str(row["url"])
                    if url in existing_article_urls:
                        skipped_existing.append(url)
                        continue
                    source_domain = str(row["source_domain"])
                    if source_domain in blocked_domains:
                        continue
                    item = dict(row)
                    if source_domain not in domain_queues:
                        domain_queues[source_domain] = []
                        domain_order.append(source_domain)
                    domain_queues[source_domain].append(item)

                if skipped_existing:
                    await self._conn.executemany(
                        """
                        UPDATE article_frontier
                        SET status = 'skipped',
                            fetched_at = NULL,
                            claimed_by = NULL,
                            claimed_at = NULL,
                            claim_expires_at = NULL,
                            updated_at = ?
                        WHERE url = ?
                        """,
                        [(now_iso, url) for url in skipped_existing],
                    )

                claimed: list[dict[str, Any]] = []
                for source_domain in domain_order:
                    domain_queue = domain_queues[source_domain]
                    for _ in range(max_per_domain):
                        if not domain_queue or len(claimed) >= limit:
                            break
                        item = domain_queue.pop(0)
                        item["claimed_by"] = owner
                        item["claimed_at"] = now_iso
                        item["claim_expires_at"] = lease_expires_at
                        claimed.append(item)
                    if len(claimed) >= limit:
                        break

                if claimed:
                    await self._conn.executemany(
                        """
                        UPDATE article_frontier
                        SET claimed_by = ?,
                            claimed_at = ?,
                            claim_expires_at = ?,
                            updated_at = ?
                        WHERE url = ?
                          AND status = 'pending'
                          AND (claim_expires_at IS NULL OR claim_expires_at <= ?)
                        """,
                        [
                            (
                                owner,
                                now_iso,
                                lease_expires_at,
                                now_iso,
                                str(item["url"]),
                                now_iso,
                            )
                            for item in claimed
                        ],
                    )
                await self._conn.commit()
            except Exception:
                await self._rollback_quietly()
                raise
            return claimed

        return await run_sqlite_write(operation, on_locked=self._rollback_quietly)

    async def list_article_frontier_pending(self, *, limit: int = 0) -> list[dict[str, Any]]:
        """Return pending article frontier rows ordered by current crawl priority."""
        if limit < 0:
            raise ValueError("limit must be non-negative")
        assert self._conn is not None
        query = """
            SELECT *
            FROM article_frontier
            WHERE status = 'pending'
            ORDER BY priority DESC, discovered_at ASC, url ASC
        """
        params: tuple[int, ...] = ()
        if limit > 0:
            query += " LIMIT ?"
            params = (limit,)
        async with self._conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def list_article_frontier_expansion_candidates(
        self,
        *,
        limit: int = 0,
        include_fetched: bool = False,
    ) -> list[dict[str, Any]]:
        """Return pending source, sitemap, feed, and robots rows for frontier expansion."""
        if limit < 0:
            raise ValueError("limit must be non-negative")
        assert self._conn is not None
        status_clause = """
            (
                status = 'pending'
                AND (claim_expires_at IS NULL OR claim_expires_at <= ?)
            )
        """
        if include_fetched:
            status_clause = f"({status_clause} OR status = 'fetched')"
        query = f"""
            SELECT *
            FROM article_frontier
            WHERE {status_clause}
                AND (
                    depth = 0
                    OR lower(url) LIKE '%/robots.txt'
                    OR lower(url) LIKE '%.xml'
                    OR lower(url) LIKE '%.xml.gz'
                    OR lower(url) LIKE '%.rss'
                    OR lower(url) LIKE '%.atom'
                    OR lower(url) LIKE '%sitemap%'
                    OR lower(url) LIKE '%/feed'
                    OR lower(url) LIKE '%/rss'
                    OR lower(url) LIKE '%/atom'
                )
            ORDER BY priority DESC, discovered_at ASC, url ASC
        """
        params: tuple[str, int] | tuple[str] = (_now(),)
        if limit > 0:
            query += " LIMIT ?"
            params = (_now(), limit)
        async with self._conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def update_article_frontier_priorities(
        self,
        priorities: dict[str, int],
        *,
        batch_size: int = 5000,
    ) -> int:
        """Update pending article frontier priorities by URL."""
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if not priorities:
            return 0

        assert self._conn is not None
        now = _now()
        updated = 0
        rows = [
            (int(priority), now, url, int(priority)) for url, priority in priorities.items() if url
        ]
        for start in range(0, len(rows), batch_size):
            updated += await self._executemany(
                """
                UPDATE article_frontier
                SET priority = ?,
                    updated_at = ?
                WHERE url = ?
                  AND status = 'pending'
                  AND priority != ?
                """,
                rows[start : start + batch_size],
            )
        return updated

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
        assert self._conn is not None
        now = _now()
        updated = 0
        rows = [(now, url, worker_id) for url in urls]
        for start in range(0, len(rows), 5000):
            updated += await self._executemany(
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
        return await self._execute_count(
            """
            UPDATE article_frontier
            SET claimed_by = NULL,
                claimed_at = NULL,
                claim_expires_at = NULL,
                updated_at = ?
            WHERE status = 'pending'
              AND claimed_by = ?
            """,
            (_now(), worker_id),
        )

    async def _mark_article_frontier_urls(self, urls: list[str], *, status: str) -> None:
        """Update the status for a collection of persisted frontier URLs."""
        if status not in {"fetched", "skipped"}:
            raise ValueError("status must be fetched or skipped")
        if not urls:
            return
        assert self._conn is not None
        now = _now()
        rows = [(status, now if status == "fetched" else None, now, url) for url in urls]
        await self._executemany(
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
