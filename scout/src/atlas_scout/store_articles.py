"""Stored-article insert and lookup mixin for Atlas Scout."""

from __future__ import annotations

import json
from typing import Any

from atlas_scout.store_core import _article_update_row, _new_id, _now


class ScoutStoreArticlesMixin:
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

        assert self._conn is not None
        urls = [str(article["url"]) for article in articles if article.get("url")]
        existing_urls = await self.existing_article_urls(urls)
        seen_urls: set[str] = set()
        rows: list[tuple[Any, ...]] = []
        update_rows: list[tuple[Any, ...]] = []
        now = _now()
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
                    _new_id(),
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
                    now,
                )
            )

        for start in range(0, len(rows), batch_size):
            await self._executemany(
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
            await self._executemany(
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
        assert self._conn is not None
        if urls is None:
            async with self._conn.execute("SELECT url FROM articles") as cursor:
                rows = await cursor.fetchall()
            return {str(row["url"]) for row in rows}
        if not urls:
            return set()

        existing: set[str] = set()
        for start in range(0, len(urls), 900):
            chunk = urls[start : start + 900]
            placeholders = ", ".join("?" for _ in chunk)
            async with self._conn.execute(
                f"SELECT url FROM articles WHERE url IN ({placeholders})",
                tuple(chunk),
            ) as cursor:
                rows = await cursor.fetchall()
            existing.update(str(row["url"]) for row in rows)
        return existing
