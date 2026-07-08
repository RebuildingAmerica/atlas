"""Imported news articles: storage, dedup by URL, and corpus stats."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import new_id, now
from atlas_scout.store.articles_support import (
    ArticleAnalyticsMixin,
    _article_record,
    _article_update_row,
)

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_ARTICLES = """
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_domain TEXT NOT NULL,
    section TEXT,
    provider TEXT NOT NULL,
    provider_id TEXT,
    api_url TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
)
"""

_CREATE_ARTICLES_PUBLISHED_INDEX = """
CREATE INDEX IF NOT EXISTS idx_articles_published_at
ON articles(published_at)
"""

_CREATE_ARTICLES_SOURCE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_articles_source_domain
ON articles(source_domain)
"""


class ArticleRepository(ArticleAnalyticsMixin):
    """Persists imported news articles and computes corpus-level stats."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create the articles table and its indexes if they don't exist."""
        await self._db.connection.execute(_CREATE_ARTICLES)
        await self._db.connection.execute(_CREATE_ARTICLES_PUBLISHED_INDEX)
        await self._db.connection.execute(_CREATE_ARTICLES_SOURCE_INDEX)

    async def bulk_save_articles(
        self,
        articles: list[dict[str, Any]],
        *,
        batch_size: int = 5000,
        update_existing: bool = False,
    ) -> dict[str, int]:
        """Insert many article records, deduping existing URLs.

        Parameters
        ----------
        articles : list[dict[str, Any]]
            Article payloads keyed by URL.
        batch_size : int, optional
            Number of rows to commit per batch. Default is 5000.
        update_existing : bool, optional
            Replace metadata for existing URLs instead of skipping them.

        Returns
        -------
        dict[str, int]
            Attempted, saved, skipped, and updated row counts.
        """
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")

        urls = [str(article["url"]) for article in articles if article.get("url")]
        existing_urls = await self.existing_article_urls(urls)
        seen_urls: set[str] = set()
        rows: list[tuple[Any, ...]] = []
        update_rows: list[tuple[Any, ...]] = []
        created_at = now()
        skipped = 0

        for article in articles:
            url = str(article.get("url") or "")
            if not url or url in seen_urls:
                skipped += 1
                continue
            seen_urls.add(url)
            if url in existing_urls:
                if update_existing:
                    update_rows.append(_article_update_row(article, url))
                else:
                    skipped += 1
                continue
            rows.append(
                (
                    new_id(),
                    url,
                    str(article["title"]),
                    str(article["published_at"]),
                    article.get("source_name"),
                    str(article["source_domain"]),
                    article.get("section"),
                    str(article["provider"]),
                    article.get("provider_id"),
                    article.get("api_url"),
                    json.dumps(article.get("metadata", {})),
                    created_at,
                )
            )

        for start in range(0, len(rows), batch_size):
            await self._db.executemany(
                """
                INSERT INTO articles
                    (
                        id,
                        url,
                        title,
                        published_at,
                        source_name,
                        source_domain,
                        section,
                        provider,
                        provider_id,
                        api_url,
                        metadata,
                        created_at
                    )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows[start : start + batch_size],
            )

        for start in range(0, len(update_rows), batch_size):
            await self._db.executemany(
                """
                UPDATE articles
                SET title = ?,
                    published_at = ?,
                    source_name = ?,
                    source_domain = ?,
                    section = ?,
                    provider = ?,
                    provider_id = ?,
                    api_url = ?,
                    metadata = ?
                WHERE url = ?
                """,
                update_rows[start : start + batch_size],
            )

        return {
            "attempted": len(articles),
            "saved": len(rows),
            "skipped": skipped,
            "updated": len(update_rows),
        }

    async def existing_article_urls(self, urls: list[str] | None = None) -> set[str]:
        """Return article URLs already stored locally."""
        conn = self._db.connection
        if urls is None:
            async with conn.execute("SELECT url FROM articles") as cursor:
                rows = await cursor.fetchall()
            return {str(row["url"]) for row in rows}
        if not urls:
            return set()

        existing: set[str] = set()
        for start in range(0, len(urls), 900):
            chunk = urls[start : start + 900]
            placeholders = ", ".join("?" for _ in chunk)
            async with conn.execute(
                f"SELECT url FROM articles WHERE url IN ({placeholders})",
                tuple(chunk),
            ) as cursor:
                rows = await cursor.fetchall()
            existing.update(str(row["url"]) for row in rows)
        return existing

    async def list_articles(
        self,
        *,
        limit: int = 100,
        provider: str | None = None,
        source_domain: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return stored articles ordered by publication time descending."""
        filters: list[str] = []
        params: list[Any] = []
        if provider is not None:
            filters.append("provider = ?")
            params.append(provider)
        if source_domain is not None:
            filters.append("source_domain = ?")
            params.append(source_domain)

        where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
        limit_clause = ""
        if limit > 0:
            limit_clause = "LIMIT ?"
            params.append(limit)
        async with self._db.connection.execute(
            f"SELECT * FROM articles {where_clause} ORDER BY published_at DESC {limit_clause}",
            tuple(params),
        ) as cursor:
            rows = await cursor.fetchall()
        return [_article_record(row) for row in rows]
