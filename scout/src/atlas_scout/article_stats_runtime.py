"""Runtime helpers for article corpus stats and maintenance commands."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click
from rich.table import Table

from atlas_scout.article_command_support import date_from_timestamp
from atlas_scout.article_mentions import extract_article_mentions, plain_article_text
from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


async def show_article_stats(
    config: ScoutConfig,
    *,
    json_output: bool,
    min_count: int | None,
    min_with_mentions: int | None,
    min_metadata_complete: int | None,
    from_date: date | None,
    to_date: date | None,
) -> None:
    """Load and print article stats with optional verification gates."""
    article_stats = await load_article_stats(config)
    total_articles = int(article_stats["total_articles"])
    if min_count is not None and total_articles < min_count:
        raise click.ClickException(
            f"Only {total_articles} articles; expected at least {min_count}."
        )
    articles_with_mentions = int(article_stats["articles_with_mentions"])
    if min_with_mentions is not None and articles_with_mentions < min_with_mentions:
        raise click.ClickException(
            f"Only {articles_with_mentions} articles with mentions; expected at least "
            f"{min_with_mentions}."
        )
    metadata_complete_articles = int(article_stats["metadata_complete_articles"])
    if min_metadata_complete is not None and metadata_complete_articles < min_metadata_complete:
        raise click.ClickException(
            f"Only {metadata_complete_articles} metadata-complete articles; expected at least "
            f"{min_metadata_complete}."
        )
    earliest = date_from_timestamp(article_stats.get("earliest_published_at"))
    latest = date_from_timestamp(article_stats.get("latest_published_at"))
    if from_date is not None and (earliest is None or earliest > from_date):
        raise click.ClickException(f"Article coverage starts after {from_date.isoformat()}.")
    if to_date is not None and (latest is None or latest < to_date):
        raise click.ClickException(f"Article coverage ends before {to_date.isoformat()}.")

    if json_output:
        click.echo(json.dumps(article_stats, sort_keys=True))
        return
    render_article_stats_table(article_stats)


async def load_article_stats(config: ScoutConfig) -> dict[str, Any]:
    """Return article stats from the configured store."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize(create_schema=False)
    try:
        return await store.article_stats()
    finally:
        await store.close()


async def show_article_status(config: ScoutConfig, *, json_output: bool) -> None:
    """Load and print fast article/frontier status counts."""
    status = await load_article_status(config)
    if json_output:
        click.echo(json.dumps(status, sort_keys=True))
        return
    render_article_status_table(status)


async def load_article_status(config: ScoutConfig) -> dict[str, Any]:
    """Return fast article/frontier status counts from the configured store."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize(create_schema=False)
    try:
        return await store.article_status_counts()
    finally:
        await store.close()


def render_article_status_table(status: dict[str, Any]) -> None:
    """Print fast article/frontier status counts as a compact terminal table."""
    table = Table(title="Article status", show_lines=False, pad_edge=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    table.add_row("Article rows", str(status["total_articles"]))
    table.add_row("Unique article URLs", str(status["unique_article_urls"]))
    table.add_row("Duplicate URL rows", str(status["duplicate_url_count"]))
    table.add_row("Articles with mentions", str(status["articles_with_mentions"]))
    table.add_row("Crawl-discovered articles", str(status["crawl_discovered_articles"]))
    table.add_row("Earliest published", str(status["earliest_published_at"]))
    table.add_row("Latest published", str(status["latest_published_at"]))
    table.add_row("Frontier total", str(status["frontier_total"]))
    table.add_row("Frontier pending", str(status["frontier_pending"]))
    table.add_row("Frontier claimed", str(status["frontier_claimed"]))
    table.add_row("Frontier fetched", str(status["frontier_fetched"]))
    table.add_row("Frontier skipped", str(status["frontier_skipped"]))
    console.print(table)


def render_article_stats_table(article_stats: dict[str, Any]) -> None:
    """Print article stats as a compact terminal table."""
    table = Table(title="Article stats", show_lines=False, pad_edge=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    table.add_row("Total articles", str(article_stats["total_articles"]))
    table.add_row("Metadata-complete articles", str(article_stats["metadata_complete_articles"]))
    table.add_row("Utility-page articles", str(article_stats["utility_page_articles"]))
    table.add_row("Articles with mentions", str(article_stats["articles_with_mentions"]))
    table.add_row("Total mentions", str(article_stats["total_mentions"]))
    table.add_row("Unique mentions", str(article_stats["unique_mentions"]))
    table.add_row("Earliest published", str(article_stats["earliest_published_at"]))
    table.add_row("Latest published", str(article_stats["latest_published_at"]))
    table.add_row("By year", json.dumps(article_stats["by_year"], sort_keys=True))
    table.add_row(
        "By source domain",
        json.dumps(article_stats["by_source_domain"], sort_keys=True),
    )
    table.add_row("By provider", json.dumps(article_stats["by_provider"], sort_keys=True))
    table.add_row(
        "By mention type",
        json.dumps(article_stats["by_mention_type"], sort_keys=True),
    )
    console.print(table)


async def dedupe_articles(config: ScoutConfig, *, dry_run: bool, json_output: bool) -> None:
    """Deduplicate exact article title/date signatures in the configured store."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        payload = await store.dedupe_articles_by_title_date(dry_run=dry_run)
    finally:
        await store.close()

    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    if dry_run:
        console.print(
            f"Found {payload['duplicate_surplus']} duplicate article rows across "
            f"{payload['duplicate_groups']} title/date groups. Re-run with --yes to delete them."
        )
        return
    console.print(
        f"Deleted {payload['deleted']} duplicate article rows across "
        f"{payload['duplicate_groups']} title/date groups."
    )


async def prune_article_quality(
    config: ScoutConfig,
    *,
    dry_run: bool,
    missing_mentions: bool,
    json_output: bool,
) -> None:
    """Prune article rows that fail selected quality gates."""
    if not missing_mentions:
        raise click.ClickException("Select at least one prune criterion.")

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        rows = await store.list_articles(limit=0)
        article_ids = [
            str(row["id"]) for row in rows if missing_mentions and _article_missing_mentions(row)
        ]
        deleted = 0 if dry_run else await _delete_articles(store, article_ids)
    finally:
        await store.close()

    payload = {
        "deleted": deleted,
        "dry_run": dry_run,
        "missing_mentions": len(article_ids),
        "scanned": len(rows),
    }
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    if dry_run:
        console.print(
            f"Found {payload['missing_mentions']} article rows missing mentions. "
            "Re-run with --yes to delete them."
        )
        return
    console.print(f"Deleted {payload['deleted']} article rows missing mentions.")


async def refresh_article_mentions(config: ScoutConfig, *, json_output: bool) -> None:
    """Refresh article mentions without importing new source records."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        rows = await store.list_articles(limit=0)
        articles_with_mentions = 0
        total_mentions = 0
        for row in rows:
            metadata = row.get("metadata")
            metadata = metadata if isinstance(metadata, dict) else {}
            mentions = extract_article_mentions(
                title=str(row.get("title") or ""),
                trail_text=plain_article_text(metadata.get("trail_text")),
                body_text=plain_article_text(metadata.get("body_text_excerpt")),
            )
            metadata["mentions"] = mentions
            row["metadata"] = metadata
            if mentions:
                articles_with_mentions += 1
                total_mentions += len(mentions)
        saved = await store.bulk_save_articles(rows, update_existing=True)
    finally:
        await store.close()

    payload = {
        "articles": len(rows),
        "updated": saved["updated"],
        "articles_with_mentions": articles_with_mentions,
        "total_mentions": total_mentions,
    }
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        f"Refreshed mentions for {payload['updated']} articles "
        f"({articles_with_mentions} with mentions, {total_mentions} total mentions)."
    )


def _article_missing_mentions(row: dict[str, Any]) -> bool:
    metadata = row.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    mentions = metadata.get("mentions")
    return not isinstance(mentions, list) or not mentions


async def _delete_articles(store: Any, article_ids: list[str]) -> int:
    deleted = 0
    for start in range(0, len(article_ids), 500):
        chunk = article_ids[start : start + 500]
        placeholders = ",".join("?" for _id in chunk)
        deleted += await store._db.execute_count(
            f"DELETE FROM articles WHERE id IN ({placeholders})",
            tuple(chunk),
        )
    return deleted
