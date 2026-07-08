"""Shared helpers and analytics for the article repository."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas_scout.articles.records import is_article_utility_page
from atlas_scout.store._util import now

if TYPE_CHECKING:
    import aiosqlite


def _optional_row_int(row: aiosqlite.Row | None, key: str) -> int:
    """Return an integer aggregate value from an optional SQLite row."""
    if row is None:
        return 0
    value = row[key]
    return int(value) if value is not None else 0


def _article_record(row: aiosqlite.Row) -> dict[str, Any]:
    """Return a JSON-ready article record from a SQLite row."""
    record = dict(row)
    record["metadata"] = json.loads(record["metadata"])
    return record


def _article_update_row(article: dict[str, Any], url: str) -> tuple[Any, ...]:
    """Return an UPDATE row for an existing article URL."""
    return (
        str(article["title"]),
        str(article["published_at"]),
        article.get("source_name"),
        str(article["source_domain"]),
        article.get("section"),
        str(article["provider"]),
        article.get("provider_id"),
        article.get("api_url"),
        json.dumps(article.get("metadata", {})),
        url,
    )


def _article_has_provider_context(metadata: dict[str, Any]) -> bool:
    """Return whether provider metadata identifies how the article was sourced."""
    has_guardian_context = bool(
        metadata.get("guardian_tags")
        or metadata.get("byline")
        or metadata.get("short_url")
        or metadata.get("thumbnail")
        or metadata.get("section_id")
        or metadata.get("pillar_name")
    )
    if has_guardian_context:
        return True
    if metadata.get("discovery_method") != "crawl" or not metadata.get("seed_url"):
        return False
    return bool(
        metadata.get("publication")
        or metadata.get("schema_types")
        or metadata.get("opengraph_type")
        or metadata.get("source_type")
    )


def _article_has_complete_metadata(row: aiosqlite.Row, metadata: dict[str, Any]) -> bool:
    """Return whether an article has enough metadata to review later."""
    required_row_values = (
        row["url"],
        row["title"],
        row["published_at"],
        row["source_domain"],
        row["provider"],
        row["provider_id"],
    )
    has_core_row = all(isinstance(value, str) and value.strip() for value in required_row_values)
    if not has_core_row:
        return False
    has_text_context = bool(
        metadata.get("trail_text")
        or metadata.get("body_text_excerpt")
        or metadata.get("body_text_length")
    )
    has_provider_context = _article_has_provider_context(metadata)
    return has_text_context and has_provider_context


class ArticleAnalyticsMixin:
    """Corpus stats and dedupe helpers for the article repository."""

    async def article_stats(self) -> dict[str, Any]:
        """Return article corpus counts and date coverage."""
        by_year: dict[str, int] = {}
        by_source_domain: dict[str, int] = {}
        by_provider: dict[str, int] = {}
        by_mention_type: dict[str, int] = {}
        article_urls: set[str] = set()
        unique_mentions: set[tuple[str, str]] = set()
        earliest: str | None = None
        latest: str | None = None
        articles_with_mentions = 0
        metadata_complete_articles = 0
        total_mentions = 0
        total_articles = 0
        crawl_articles = 0
        crawl_discovered_articles = 0
        utility_page_articles = 0
        async with self._db.connection.execute("SELECT * FROM articles") as cursor:
            async for row in cursor:
                total_articles += 1
                article_url = str(row["url"])
                article_urls.add(article_url)
                published_at = str(row["published_at"])
                year = published_at[:4]
                by_year[year] = by_year.get(year, 0) + 1
                source_domain = str(row["source_domain"])
                by_source_domain[source_domain] = by_source_domain.get(source_domain, 0) + 1
                provider = str(row["provider"])
                by_provider[provider] = by_provider.get(provider, 0) + 1
                if provider == "crawl":
                    crawl_articles += 1
                earliest = published_at if earliest is None else min(earliest, published_at)
                latest = published_at if latest is None else max(latest, published_at)
                metadata = json.loads(row["metadata"])
                metadata = metadata if isinstance(metadata, dict) else {}
                schema_types = metadata.get("schema_types")
                schema_types = schema_types if isinstance(schema_types, list) else []
                if is_article_utility_page(
                    url=article_url,
                    title=str(row["title"]),
                    schema_types=[str(schema_type) for schema_type in schema_types],
                ):
                    utility_page_articles += 1
                if provider == "crawl" and metadata.get("discovery_method") == "crawl":
                    crawl_discovered_articles += 1
                if _article_has_complete_metadata(row, metadata):
                    metadata_complete_articles += 1
                mentions = metadata.get("mentions")
                if isinstance(mentions, list) and mentions:
                    articles_with_mentions += 1
                    total_mentions += len(mentions)
                    for mention in mentions:
                        if not isinstance(mention, dict):
                            continue
                        mention_name = str(mention.get("name") or "").strip()
                        mention_type = str(mention.get("type") or "unknown").strip() or "unknown"
                        if not mention_name:
                            continue
                        unique_mentions.add((mention_type, mention_name.casefold()))
                        by_mention_type[mention_type] = by_mention_type.get(mention_type, 0) + 1

        unique_article_urls = len(article_urls)
        duplicate_url_count = total_articles - unique_article_urls
        semantic_duplicates = await self.article_semantic_duplicate_stats()

        return {
            "total_articles": total_articles,
            "unique_article_urls": unique_article_urls,
            "duplicate_url_count": duplicate_url_count,
            "semantic_duplicate_groups": semantic_duplicates["duplicate_groups"],
            "semantic_duplicate_surplus": semantic_duplicates["duplicate_surplus"],
            "earliest_published_at": earliest,
            "latest_published_at": latest,
            "by_year": by_year,
            "by_source_domain": by_source_domain,
            "by_provider": by_provider,
            "crawl_articles": crawl_articles,
            "crawl_discovered_articles": crawl_discovered_articles,
            "utility_page_articles": utility_page_articles,
            "articles_with_mentions": articles_with_mentions,
            "metadata_complete_articles": metadata_complete_articles,
            "total_mentions": total_mentions,
            "unique_mentions": len(unique_mentions),
            "by_mention_type": by_mention_type,
        }

    async def article_domain_counts(self) -> dict[str, int]:
        """Return article counts by source domain without scanning article metadata."""
        async with self._db.connection.execute(
            """
            SELECT source_domain, COUNT(*) AS count
            FROM articles
            GROUP BY source_domain
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return {str(row["source_domain"]): int(row["count"]) for row in rows}

    async def article_semantic_duplicate_stats(self) -> dict[str, int]:
        """Return duplicate article counts for exact normalized title/date signatures."""
        async with self._db.connection.execute(
            """
            SELECT
                COUNT(*) AS duplicate_groups,
                COALESCE(SUM(count_per_signature - 1), 0) AS duplicate_surplus
            FROM (
                SELECT LOWER(TRIM(title)) AS title_key,
                       published_at,
                       COUNT(*) AS count_per_signature
                FROM articles
                GROUP BY title_key, published_at
                HAVING count_per_signature > 1
            )
            """
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return {"duplicate_groups": 0, "duplicate_surplus": 0}
        return {
            "duplicate_groups": int(row["duplicate_groups"]),
            "duplicate_surplus": int(row["duplicate_surplus"]),
        }

    async def article_status_counts(self) -> dict[str, Any]:
        """Return fast article/frontier counts for live crawl status."""
        async with self._db.connection.execute(
            """
            SELECT
                COUNT(*) AS total_articles,
                COUNT(DISTINCT url) AS unique_article_urls,
                MIN(published_at) AS earliest_published_at,
                MAX(published_at) AS latest_published_at,
                SUM(CASE WHEN provider = 'crawl' THEN 1 ELSE 0 END) AS crawl_articles,
                SUM(
                    CASE
                        WHEN provider = 'crawl'
                         AND json_extract(metadata, '$.discovery_method') = 'crawl'
                        THEN 1
                        ELSE 0
                    END
                ) AS crawl_discovered_articles,
                SUM(
                    CASE
                        WHEN COALESCE(json_array_length(json_extract(metadata, '$.mentions')), 0) > 0
                        THEN 1
                        ELSE 0
                    END
                ) AS articles_with_mentions
            FROM articles
            """
        ) as cursor:
            article_row = await cursor.fetchone()

        async with self._db.connection.execute(
            "SELECT status, COUNT(*) AS count FROM article_frontier GROUP BY status"
        ) as cursor:
            frontier_rows = await cursor.fetchall()
        frontier_counts = {"pending": 0, "fetched": 0, "skipped": 0}
        for row in frontier_rows:
            status = str(row["status"])
            if status in frontier_counts:
                frontier_counts[status] = int(row["count"])

        async with self._db.connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM article_frontier
            WHERE status = 'pending'
              AND claim_expires_at > ?
            """,
            (now(),),
        ) as cursor:
            claimed_row = await cursor.fetchone()

        total_articles = _optional_row_int(article_row, "total_articles")
        unique_article_urls = _optional_row_int(article_row, "unique_article_urls")
        return {
            "total_articles": total_articles,
            "unique_article_urls": unique_article_urls,
            "duplicate_url_count": total_articles - unique_article_urls,
            "earliest_published_at": (
                article_row["earliest_published_at"] if article_row is not None else None
            ),
            "latest_published_at": (
                article_row["latest_published_at"] if article_row is not None else None
            ),
            "crawl_articles": _optional_row_int(article_row, "crawl_articles"),
            "crawl_discovered_articles": _optional_row_int(
                article_row,
                "crawl_discovered_articles",
            ),
            "articles_with_mentions": _optional_row_int(article_row, "articles_with_mentions"),
            "frontier_pending": frontier_counts["pending"],
            "frontier_fetched": frontier_counts["fetched"],
            "frontier_skipped": frontier_counts["skipped"],
            "frontier_claimed": _optional_row_int(claimed_row, "count"),
            "frontier_total": sum(frontier_counts.values()),
        }

    async def dedupe_articles_by_title_date(self, *, dry_run: bool) -> dict[str, int | bool]:
        """Delete duplicate article rows sharing the same normalized title and timestamp."""
        duplicate_stats = await self.article_semantic_duplicate_stats()
        deleted = 0
        if not dry_run and duplicate_stats["duplicate_surplus"]:
            await self._db.connection.execute(
                """
                WITH ranked AS (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY LOWER(TRIM(title)), published_at
                               ORDER BY created_at ASC, LENGTH(url) ASC, url ASC
                           ) AS rank_in_signature
                    FROM articles
                )
                DELETE FROM articles
                WHERE id IN (
                    SELECT id
                    FROM ranked
                    WHERE rank_in_signature > 1
                )
                """
            )
            await self._db.connection.commit()
            deleted = duplicate_stats["duplicate_surplus"]
        return {
            "duplicate_groups": duplicate_stats["duplicate_groups"],
            "duplicate_surplus": duplicate_stats["duplicate_surplus"],
            "deleted": deleted,
            "dry_run": dry_run,
        }
