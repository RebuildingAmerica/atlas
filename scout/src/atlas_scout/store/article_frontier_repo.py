"""Durable article crawl frontier: discovery, domain-balanced leasing, and stats."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from atlas_scout.store._util import now
from atlas_scout.store.article_frontier_support import ArticleFrontierMaintenanceMixin

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_ARTICLE_FRONTIER = """
CREATE TABLE IF NOT EXISTS article_frontier (
    url TEXT PRIMARY KEY,
    seed_url TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0 CHECK(depth >= 0),
    priority INTEGER NOT NULL DEFAULT 0,
    source_domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'fetched', 'skipped')),
    discovered_at TEXT NOT NULL,
    fetched_at TEXT,
    claimed_by TEXT,
    claimed_at TEXT,
    claim_expires_at TEXT,
    updated_at TEXT NOT NULL
)
"""

_CREATE_ARTICLE_FRONTIER_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_frontier_status_priority
ON article_frontier(status, priority DESC, discovered_at ASC)
"""

_CREATE_ARTICLE_FRONTIER_DOMAIN_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_frontier_source_domain
ON article_frontier(source_domain, status)
"""

_CREATE_ARTICLE_FRONTIER_CLAIM_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_frontier_claims
ON article_frontier(status, claim_expires_at, priority DESC, discovered_at ASC)
"""


class ArticleFrontierRepository(ArticleFrontierMaintenanceMixin):
    """Persists a durable, resumable, domain-balanced article crawl frontier."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create or migrate the article frontier table and its indexes."""
        conn = self._db.connection
        await conn.execute(_CREATE_ARTICLE_FRONTIER)
        async with conn.execute("PRAGMA table_info(article_frontier)") as cursor:
            rows = await cursor.fetchall()
        columns = {str(row["name"]) for row in rows}
        migrations = {
            "claimed_by": "ALTER TABLE article_frontier ADD COLUMN claimed_by TEXT",
            "claimed_at": "ALTER TABLE article_frontier ADD COLUMN claimed_at TEXT",
            "claim_expires_at": "ALTER TABLE article_frontier ADD COLUMN claim_expires_at TEXT",
        }
        for column, sql in migrations.items():
            if column not in columns:
                await conn.execute(sql)
        await conn.execute(_CREATE_ARTICLE_FRONTIER_STATUS_INDEX)
        await conn.execute(_CREATE_ARTICLE_FRONTIER_DOMAIN_INDEX)
        await conn.execute(_CREATE_ARTICLE_FRONTIER_CLAIM_INDEX)

    async def upsert_article_frontier(
        self,
        items: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
    ) -> dict[str, int]:
        """Persist newly discovered article frontier URLs for resumable crawls."""
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")

        seen_urls: set[str] = set()
        candidate_rows: list[tuple[str, str, int, int, str, str, str]] = []
        discovered_at = now()
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
            candidate_rows.append(
                (url, seed_url, depth, priority, source_domain, discovered_at, discovered_at)
            )

        if not candidate_rows:
            return {"attempted": len(items), "saved": 0, "skipped": skipped}

        existing_urls = await self._existing_frontier_urls([row[0] for row in candidate_rows])
        insert_rows = [row for row in candidate_rows if row[0] not in existing_urls]
        skipped += len(candidate_rows) - len(insert_rows)
        for start in range(0, len(insert_rows), batch_size):
            await self._db.executemany(
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
        conn = self._db.connection
        existing: set[str] = set()
        for start in range(0, len(urls), 900):
            chunk = urls[start : start + 900]
            placeholders = ", ".join("?" for _ in chunk)
            async with conn.execute(
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

        owner = worker_id or f"article-frontier-{uuid.uuid4().hex}"
        current_time = datetime.now(UTC)
        now_iso = current_time.isoformat()
        lease_expires_at = (current_time + timedelta(seconds=lease_seconds)).isoformat()
        scan_limit = max(limit * 100, limit)

        async def operation() -> list[dict[str, Any]]:
            conn = self._db.connection
            await conn.execute("BEGIN IMMEDIATE")
            try:
                async with conn.execute(
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
                    await conn.executemany(
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
                    await conn.executemany(
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
                await conn.commit()
            except Exception:
                await self._db.rollback_quietly()
                raise
            return claimed

        return await self._db.run_write(operation)

    async def list_article_frontier_pending(self, *, limit: int = 0) -> list[dict[str, Any]]:
        """Return pending article frontier rows ordered by current crawl priority."""
        if limit < 0:
            raise ValueError("limit must be non-negative")
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
        async with self._db.connection.execute(query, params) as cursor:
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
        params: tuple[str, int] | tuple[str] = (now(),)
        if limit > 0:
            query += " LIMIT ?"
            params = (now(), limit)
        async with self._db.connection.execute(query, params) as cursor:
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

        updated_at = now()
        updated = 0
        rows = [
            (int(priority), updated_at, url, int(priority))
            for url, priority in priorities.items()
            if url
        ]
        for start in range(0, len(rows), batch_size):
            updated += await self._db.executemany(
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
