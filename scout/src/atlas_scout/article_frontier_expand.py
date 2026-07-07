"""Expansion runtime for the persisted article frontier."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click

from atlas_scout.article_command_support import date_from_timestamp
from atlas_scout.article_discovery_records import url_derived_article_record
from atlas_scout.article_frontier import (
    article_crawl_is_discovery_resource,
    article_crawl_url_outside_date_window,
    article_frontier_item,
    source_seed_frontier_priority,
)
from atlas_scout.article_urls import canonicalize_article_url
from atlas_scout.cli_context import console
from atlas_scout.pipeline_support import close_if_supported, normalize_url

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


async def expand_frontier(
    config: ScoutConfig,
    *,
    limit: int,
    max_concurrent: int | None,
    max_per_domain: int,
    timeout_seconds: float | None,
    delay_ms: int | None,
    from_date: date | None,
    to_date: date | None,
    browser_renders: int | None,
    refresh: bool,
    save_articles: bool,
    include_fetched: bool,
    json_output: bool,
) -> None:
    """Expand sitemap/feed/source frontier rows without saving article records."""
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    effective_max_concurrent = max_concurrent or config.scraper.max_concurrent_fetches
    fetcher = AsyncFetcher(
        max_concurrent=effective_max_concurrent,
        request_delay_ms=delay_ms if delay_ms is not None else config.scraper.request_delay_ms,
        timeout=timeout_seconds if timeout_seconds is not None else 30.0,
        page_cache_ttl_days=config.scraper.page_cache_ttl_days,
        revisit_cached_urls=config.scraper.revisit_cached_urls,
        store=store,
        run_id="articles-frontier-expand",
        force_refresh=refresh,
        browser_fallback_enabled=config.scraper.browser_fallback_enabled,
        browser_render_timeout_ms=config.scraper.browser_render_timeout_ms,
        max_browser_renders_per_run=(
            browser_renders
            if browser_renders is not None
            else config.scraper.max_browser_renders_per_run
        ),
        max_browser_concurrent=config.scraper.max_browser_concurrent,
    )

    fetched = 0
    discovered = 0
    frontier_saved = 0
    frontier_skipped = 0
    articles_saved = 0
    articles_skipped = 0
    articles_updated = 0
    pruned_by_date = 0
    skipped_existing = 0
    discovered_urls: set[str] = set()
    try:
        rows = await store.list_article_frontier_expansion_candidates(
            limit=max(limit * 100, limit),
            include_fetched=include_fetched,
        )
        expandable_rows = expandable_frontier_rows(
            rows,
            limit=limit,
            max_per_domain=max_per_domain,
        )
        existing_article_urls = set() if refresh else await store.existing_article_urls()

        for start in range(0, len(expandable_rows), effective_max_concurrent):
            batch_rows = expandable_rows[start : start + effective_max_concurrent]
            outcomes = await asyncio.gather(
                *(
                    fetcher.fetch_tracked_verbose(str(row["url"]), task_id="", _store=store)
                    for row in batch_rows
                )
            )
            fetched += len(outcomes)
            frontier_items, article_records, counters = collect_expansion_frontier_items(
                batch_rows,
                outcomes,
                existing_article_urls=existing_article_urls,
                discovered_urls=discovered_urls,
                from_date=from_date,
                to_date=to_date,
                save_articles=save_articles,
            )
            discovered += counters["discovered"]
            if article_records:
                article_save = await store.bulk_save_articles(article_records, update_existing=True)
                articles_saved += article_save["saved"]
                articles_skipped += article_save["skipped"]
                articles_updated += article_save["updated"]
            pruned_by_date += counters["pruned_by_date"]
            skipped_existing += counters["skipped_existing"]
            if frontier_items:
                frontier_save = await store.upsert_article_frontier(frontier_items)
                frontier_saved += frontier_save["saved"]
                frontier_skipped += frontier_save["skipped"]
            await store.mark_article_frontier_fetched([str(row["url"]) for row in batch_rows])
        frontier_stats = await store.article_frontier_stats()
    finally:
        await close_if_supported(fetcher)
        await store.close()

    payload = {
        **frontier_stats,
        "claimed": len(expandable_rows),
        "fetched": fetched,
        "discovered": discovered,
        "frontier_saved": frontier_saved,
        "frontier_skipped": frontier_skipped,
        "article_records": articles_saved,
        "article_records_skipped": articles_skipped,
        "article_records_updated": articles_updated,
        "pruned_by_date": pruned_by_date,
        "skipped_existing": skipped_existing,
    }
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        f"Expanded {fetched} discovery frontier URLs and saved {frontier_saved} pending crawl URLs."
    )


def collect_expansion_frontier_items(
    batch_rows: list[dict[str, Any]],
    outcomes: list[dict[str, Any]],
    *,
    existing_article_urls: set[str],
    discovered_urls: set[str],
    from_date: date | None,
    to_date: date | None,
    save_articles: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Convert fetch outcomes into new frontier items and counters."""
    counters = {
        "discovered": 0,
        "article_records": 0,
        "pruned_by_date": 0,
        "skipped_existing": 0,
    }
    frontier_items: list[dict[str, Any]] = []
    article_records: list[dict[str, Any]] = []
    for row, outcome in zip(batch_rows, outcomes, strict=True):
        seed_url = str(row["seed_url"])
        depth = int(row["depth"])
        if save_articles:
            records = outcome.get("discovery_articles")
            for article in records if isinstance(records, list) else []:
                if not isinstance(article, dict):
                    continue
                article_url = canonicalize_article_url(str(article.get("url") or ""))
                if not article_url:
                    continue
                published_date = date_from_timestamp(article.get("published_at"))
                if (
                    published_date is None
                    or (from_date is not None and published_date < from_date)
                    or (to_date is not None and published_date > to_date)
                ):
                    counters["pruned_by_date"] += 1
                    continue
                if article_url in existing_article_urls or article_url in discovered_urls:
                    counters["skipped_existing"] += 1
                    continue
                discovered_urls.add(article_url)
                article_records.append(article)
                counters["article_records"] += 1
        links = outcome.get("discovered_links")
        for link in links if isinstance(links, list) else []:
            normalized = normalize_url(str(link))
            if not article_crawl_is_discovery_resource(normalized):
                normalized = canonicalize_article_url(normalized)
            if article_crawl_url_outside_date_window(
                normalized,
                from_date=from_date,
                to_date=to_date,
            ):
                counters["pruned_by_date"] += 1
                continue
            if normalized in existing_article_urls or normalized in discovered_urls:
                counters["skipped_existing"] += 1
                continue
            if save_articles and not article_crawl_is_discovery_resource(normalized):
                article = url_derived_article_record(
                    normalized,
                    seed_url=seed_url,
                    from_date=from_date,
                    to_date=to_date,
                    extraction_method="linked_url",
                    source_type="discovered_link",
                )
                if article is not None:
                    discovered_urls.add(normalized)
                    article_records.append(article)
                    counters["article_records"] += 1
                    continue
            discovered_urls.add(normalized)
            counters["discovered"] += 1
            frontier_items.append(
                article_frontier_item(
                    url=normalized,
                    seed_url=seed_url,
                    depth=depth + 1,
                )
            )
    return frontier_items, article_records, counters


def expandable_frontier_rows(
    rows: list[dict[str, Any]],
    *,
    limit: int,
    max_per_domain: int,
) -> list[dict[str, Any]]:
    """Return frontier rows that can be expanded without consuming article work."""
    expandable: list[dict[str, Any]] = []
    domain_counts: dict[str, int] = {}
    for row in rows:
        url = str(row["url"])
        depth = int(row["depth"])
        priority = int(row["priority"])
        if not is_frontier_expansion_candidate(url=url, depth=depth, priority=priority):
            continue
        source_domain = str(row["source_domain"])
        if domain_counts.get(source_domain, 0) >= max_per_domain:
            continue
        expandable.append(row)
        domain_counts[source_domain] = domain_counts.get(source_domain, 0) + 1
        if len(expandable) >= limit:
            break
    return expandable


def is_frontier_expansion_candidate(*, url: str, depth: int, priority: int) -> bool:
    """Return whether a frontier URL should be expanded instead of article-fetched."""
    return article_crawl_is_discovery_resource(url) or (
        depth == 0 and priority <= source_seed_frontier_priority(url)
    )
