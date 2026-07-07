"""Article corpus verification gates."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import click

from atlas_scout.article_command_support import date_from_timestamp
from atlas_scout.article_stats_runtime import load_article_stats
from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


async def verify_articles(
    config: ScoutConfig,
    *,
    json_output: bool,
    min_count: int | None,
    min_unique_urls: int | None,
    min_crawl: int | None,
    min_crawl_discovered: int | None,
    min_with_mentions: int | None,
    min_metadata_complete: int | None,
    from_date: date | None,
    to_date: date | None,
    published_from: date | None,
    published_through: date | None,
) -> None:
    """Load article stats and enforce launch verification gates."""
    article_stats = await load_article_stats(config)
    verify_article_stats(
        article_stats,
        min_count=min_count,
        min_unique_urls=min_unique_urls,
        min_crawl=min_crawl,
        min_crawl_discovered=min_crawl_discovered,
        min_with_mentions=min_with_mentions,
        min_metadata_complete=min_metadata_complete,
        from_date=from_date,
        to_date=to_date,
        published_from=published_from,
        published_through=published_through,
    )
    payload = {"ok": True, **article_stats}
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        "Article verification passed: "
        f"{payload['total_articles']} articles, "
        f"{payload['unique_article_urls']} unique URLs, "
        f"{payload['crawl_discovered_articles']} crawl-discovered."
    )


def verify_article_stats(
    stats: dict[str, Any],
    *,
    min_count: int | None,
    min_unique_urls: int | None,
    min_crawl: int | None,
    min_crawl_discovered: int | None,
    min_with_mentions: int | None,
    min_metadata_complete: int | None,
    from_date: date | None,
    to_date: date | None,
    published_from: date | None,
    published_through: date | None,
) -> None:
    """Raise a ClickException when article verification gates fail."""
    duplicate_url_count = int(stats["duplicate_url_count"])
    if duplicate_url_count:
        raise click.ClickException(f"Found {duplicate_url_count} duplicate article URL rows.")
    semantic_duplicate_surplus = int(stats["semantic_duplicate_surplus"])
    if semantic_duplicate_surplus:
        raise click.ClickException(
            f"Found {semantic_duplicate_surplus} semantic duplicate article rows."
        )
    utility_page_articles = int(stats["utility_page_articles"])
    if utility_page_articles:
        raise click.ClickException(f"Found {utility_page_articles} utility-page article rows.")

    total_articles = int(stats["total_articles"])
    if min_count is not None and total_articles < min_count:
        raise click.ClickException(
            f"Only {total_articles} articles; expected at least {min_count}."
        )

    unique_article_urls = int(stats["unique_article_urls"])
    if min_unique_urls is not None and unique_article_urls < min_unique_urls:
        raise click.ClickException(
            f"Only {unique_article_urls} unique article URLs; expected at least {min_unique_urls}."
        )

    crawl_articles = int(stats["crawl_articles"])
    if min_crawl is not None and crawl_articles < min_crawl:
        raise click.ClickException(
            f"Only {crawl_articles} crawl-provider articles; expected at least {min_crawl}."
        )

    crawl_discovered_articles = int(stats["crawl_discovered_articles"])
    if min_crawl_discovered is not None and crawl_discovered_articles < min_crawl_discovered:
        raise click.ClickException(
            f"Only {crawl_discovered_articles} crawl-discovered articles; expected at least "
            f"{min_crawl_discovered}."
        )

    articles_with_mentions = int(stats["articles_with_mentions"])
    if min_with_mentions is not None and articles_with_mentions < min_with_mentions:
        raise click.ClickException(
            f"Only {articles_with_mentions} articles with mentions; expected at least "
            f"{min_with_mentions}."
        )

    metadata_complete_articles = int(stats["metadata_complete_articles"])
    if min_metadata_complete is not None and metadata_complete_articles < min_metadata_complete:
        raise click.ClickException(
            f"Only {metadata_complete_articles} metadata-complete articles; expected at least "
            f"{min_metadata_complete}."
        )

    earliest = date_from_timestamp(stats.get("earliest_published_at"))
    latest = date_from_timestamp(stats.get("latest_published_at"))
    if from_date is not None and (earliest is None or earliest > from_date):
        raise click.ClickException(f"Article coverage starts after {from_date.isoformat()}.")
    if to_date is not None and (latest is None or latest < to_date):
        raise click.ClickException(f"Article coverage ends before {to_date.isoformat()}.")
    if published_from is not None and (earliest is None or earliest < published_from):
        raise click.ClickException(
            f"Article corpus includes rows before {published_from.isoformat()}."
        )
    if published_through is not None and (latest is None or latest > published_through):
        raise click.ClickException(
            f"Article corpus includes rows after {published_through.isoformat()}."
        )
