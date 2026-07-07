"""Runtime implementation for article crawling."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections import deque
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click

from atlas_scout.articles.crawl_outcomes import handle_crawl_outcome
from atlas_scout.articles.frontier import (
    article_crawl_blocked_domains,
    next_article_crawl_batch,
)
from atlas_scout.cli_context import console
from atlas_scout.pipeline_support import close_if_supported, normalize_url

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


async def run_article_crawl(
    config: ScoutConfig,
    *,
    seed_urls: list[str],
    target_count: int,
    max_pages: int,
    max_depth: int,
    max_concurrent: int | None,
    max_per_domain: int,
    max_save_per_domain: int | None,
    frontier_claim_size: int | None,
    frontier_lease_seconds: int,
    timeout_seconds: float | None,
    delay_ms: int | None,
    from_date: date | None,
    to_date: date | None,
    browser_renders: int | None,
    refresh: bool,
    resume_frontier: bool,
    persist_frontier: bool,
    json_output: bool,
) -> None:
    """Run a bounded crawl and persist discovered news article pages."""
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    domain_saved_counts = await _domain_saved_counts(store, max_save_per_domain=max_save_per_domain)
    existing_article_urls = set() if refresh else await store.existing_article_urls()
    effective_max_concurrent = max_concurrent or config.scraper.max_concurrent_fetches
    frontier_worker_id = f"articles-crawl:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    fetcher = AsyncFetcher(
        max_concurrent=effective_max_concurrent,
        request_delay_ms=delay_ms if delay_ms is not None else config.scraper.request_delay_ms,
        timeout=timeout_seconds if timeout_seconds is not None else 30.0,
        page_cache_ttl_days=config.scraper.page_cache_ttl_days,
        revisit_cached_urls=config.scraper.revisit_cached_urls,
        store=store,
        run_id=frontier_worker_id,
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

    frontier_claimed = 0
    frontier_released = 0
    frontier_saved = 0
    frontier_skipped = 0
    frontier_known_urls: set[str] = set()
    effective_frontier_claim_size = frontier_claim_size or max(effective_max_concurrent * 4, 100)
    queue: deque[tuple[str, str, int]] = deque(
        (normalize_url(seed_url), normalize_url(seed_url), 0) for seed_url in seed_urls
    )
    queued: set[str] = {url for url, _seed_url, _depth in queue}
    seen: set[str] = set()
    fetched = 0
    filtered = 0
    saved_total = 0
    skipped_total = 0
    updated_total = 0
    enqueued = len(queue)
    pruned_by_date = 0
    skipped_existing = 0
    skipped_by_domain_cap = 0
    by_source_domain: dict[str, int] = {}
    batch: list[dict[str, Any]] = []

    async def claim_more_frontier(limit: int) -> None:
        nonlocal enqueued, frontier_claimed
        if limit <= 0:
            return
        await _refresh_domain_saved_counts(
            store,
            domain_saved_counts,
            max_save_per_domain=max_save_per_domain,
        )
        frontier_items = await store.claim_article_frontier_batch(
            limit=limit,
            max_per_domain=max_per_domain,
            blocked_domains=article_crawl_blocked_domains(
                domain_saved_counts,
                max_save_per_domain=max_save_per_domain,
            ),
            existing_article_urls=existing_article_urls,
            worker_id=frontier_worker_id,
            lease_seconds=frontier_lease_seconds,
        )
        frontier_claimed += len(frontier_items)
        for item in frontier_items:
            url = str(item["url"])
            if url in queued or url in seen:
                continue
            queue.append((url, str(item["seed_url"]), int(item["depth"])))
            queued.add(url)
            enqueued += 1
            frontier_known_urls.add(url)

    try:
        while fetched < max_pages and saved_total < target_count:
            if resume_frontier and len(queue) < effective_max_concurrent:
                frontier_room = max_pages - fetched - len(queue)
                await claim_more_frontier(min(effective_frontier_claim_size, frontier_room))
            if not queue:
                break
            crawl_batch = next_article_crawl_batch(
                queue,
                seen,
                batch_limit=min(
                    effective_max_concurrent,
                    max_pages - fetched,
                    max(1, target_count - saved_total - len(batch)),
                ),
                max_per_domain=max_per_domain,
                blocked_domains=article_crawl_blocked_domains(
                    domain_saved_counts,
                    max_save_per_domain=max_save_per_domain,
                ),
                existing_article_urls=existing_article_urls,
            )
            skipped_by_domain_cap += crawl_batch.skipped_by_domain_cap
            skipped_existing += crawl_batch.skipped_existing
            if not crawl_batch.items:
                continue

            outcomes = await asyncio.gather(
                *(
                    fetcher.fetch_tracked_verbose(url, task_id="", _store=store)
                    for url, _seed_url, _depth in crawl_batch.items
                )
            )

            for crawl_item, outcome in zip(crawl_batch.items, outcomes, strict=True):
                counters = await handle_crawl_outcome(
                    crawl_item,
                    outcome,
                    store=store,
                    batch=batch,
                    frontier_known_urls=frontier_known_urls,
                    existing_article_urls=existing_article_urls,
                    domain_saved_counts=domain_saved_counts,
                    by_source_domain=by_source_domain,
                    queued=queued,
                    queue=queue,
                    seen=seen,
                    max_depth=max_depth,
                    target_count=target_count,
                    saved_total=saved_total,
                    max_save_per_domain=max_save_per_domain,
                    from_date=from_date,
                    to_date=to_date,
                    persist_frontier=persist_frontier,
                    resume_frontier=resume_frontier,
                )
                fetched += 1
                filtered += counters["filtered"]
                pruned_by_date += counters["pruned_by_date"]
                skipped_existing += counters["skipped_existing"]
                skipped_by_domain_cap += counters["skipped_by_domain_cap"]
                frontier_saved += counters["frontier_saved"]
                frontier_skipped += counters["frontier_skipped"]
                enqueued += counters["enqueued"]
                if len(batch) >= 100 or saved_total + len(batch) >= target_count:
                    saved = await store.bulk_save_articles(batch, update_existing=True)
                    saved_total += saved["saved"]
                    skipped_total += saved["skipped"]
                    updated_total += saved["updated"]
                    batch = []

        if batch:
            saved = await store.bulk_save_articles(batch, update_existing=True)
            saved_total += saved["saved"]
            skipped_total += saved["skipped"]
            updated_total += saved["updated"]
    finally:
        try:
            await close_if_supported(fetcher)
            frontier_released = await store.release_article_frontier_claims(
                list(frontier_known_urls),
                worker_id=frontier_worker_id,
            )
        finally:
            await store.close()

    payload = {
        "seeds": len(seed_urls),
        "target_count": target_count,
        "max_pages": max_pages,
        "max_depth": max_depth,
        "fetched": fetched,
        "filtered": filtered,
        "enqueued": enqueued,
        "pruned_by_date": pruned_by_date,
        "saved": saved_total,
        "frontier_claimed": frontier_claimed,
        "frontier_claim_size": effective_frontier_claim_size,
        "frontier_lease_seconds": frontier_lease_seconds,
        "frontier_released": frontier_released,
        "frontier_saved": frontier_saved,
        "frontier_skipped": frontier_skipped,
        "frontier_worker_id": frontier_worker_id,
        "skipped_existing": skipped_existing,
        "skipped_by_domain_cap": skipped_by_domain_cap,
        "skipped": skipped_total,
        "updated": updated_total,
        "by_source_domain": by_source_domain,
    }
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        f"Crawled {fetched} pages and saved {saved_total} article records "
        f"({updated_total} updated, {filtered} filtered)."
    )


async def _domain_saved_counts(store: Any, *, max_save_per_domain: int | None) -> dict[str, int]:
    if max_save_per_domain is None:
        return {}
    counts = await store.article_domain_counts()
    if not isinstance(counts, dict):
        return {}
    return {str(domain): int(count) for domain, count in counts.items() if isinstance(count, int)}


async def _refresh_domain_saved_counts(
    store: Any,
    domain_saved_counts: dict[str, int],
    *,
    max_save_per_domain: int | None,
) -> None:
    if max_save_per_domain is None:
        return
    domain_saved_counts.update(
        await _domain_saved_counts(store, max_save_per_domain=max_save_per_domain)
    )
