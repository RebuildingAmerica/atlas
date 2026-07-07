"""Outcome handling for article crawl fetches."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from atlas_shared import PageContent

from atlas_scout.articles.frontier import (
    article_crawl_domain_at_cap,
    article_crawl_is_discovery_resource,
    article_crawl_url_outside_date_window,
    article_frontier_item,
)
from atlas_scout.articles.records import crawled_article_from_page
from atlas_scout.articles.urls import canonicalize_article_url
from atlas_scout.pipeline_support import normalize_url

if TYPE_CHECKING:
    from collections import deque
    from datetime import date


async def handle_crawl_outcome(
    crawl_item: tuple[str, str, int],
    outcome: dict[str, Any],
    *,
    store: Any,
    batch: list[dict[str, Any]],
    frontier_known_urls: set[str],
    existing_article_urls: set[str],
    domain_saved_counts: dict[str, int],
    by_source_domain: dict[str, int],
    queued: set[str],
    queue: deque[tuple[str, str, int]],
    seen: set[str],
    max_depth: int,
    target_count: int,
    saved_total: int,
    max_save_per_domain: int | None,
    from_date: date | None,
    to_date: date | None,
    persist_frontier: bool,
    resume_frontier: bool,
) -> dict[str, int]:
    """Handle one fetched crawl outcome and return counter deltas."""
    url, seed_url, depth = crawl_item
    counters = _zero_counters()
    page = outcome.get("page")
    if isinstance(page, PageContent):
        article = crawled_article_from_page(
            page,
            seed_url=seed_url,
            crawl_depth=depth,
            from_date=from_date,
            to_date=to_date,
        )
        if article is None:
            counters["filtered"] += 1
        else:
            _append_article_if_new(
                article,
                batch=batch,
                existing_article_urls=existing_article_urls,
                domain_saved_counts=domain_saved_counts,
                by_source_domain=by_source_domain,
                max_save_per_domain=max_save_per_domain,
                counters=counters,
            )
    else:
        counters["filtered"] += 1

    if depth < max_depth and saved_total < target_count:
        frontier_counters = await _record_discovered_links(
            outcome,
            seed_url=seed_url,
            depth=depth,
            store=store,
            frontier_known_urls=frontier_known_urls,
            existing_article_urls=existing_article_urls,
            domain_saved_counts=domain_saved_counts,
            queued=queued,
            queue=queue,
            seen=seen,
            max_save_per_domain=max_save_per_domain,
            from_date=from_date,
            to_date=to_date,
            persist_frontier=persist_frontier,
            resume_frontier=resume_frontier,
        )
        for key, value in frontier_counters.items():
            counters[key] += value
    if url in frontier_known_urls:
        await store.mark_article_frontier_fetched([url])
    return counters


def _append_article_if_new(
    article: dict[str, Any],
    *,
    batch: list[dict[str, Any]],
    existing_article_urls: set[str],
    domain_saved_counts: dict[str, int],
    by_source_domain: dict[str, int],
    max_save_per_domain: int | None,
    counters: dict[str, int],
) -> None:
    source_domain = str(article["source_domain"])
    article_url = str(article["url"])
    if article_url in existing_article_urls:
        counters["skipped_existing"] += 1
        return
    if article_crawl_domain_at_cap(
        source_domain,
        domain_saved_counts,
        max_save_per_domain=max_save_per_domain,
    ):
        counters["skipped_by_domain_cap"] += 1
        return
    batch.append(article)
    if max_save_per_domain is not None:
        domain_saved_counts[source_domain] = domain_saved_counts.get(source_domain, 0) + 1
    existing_article_urls.add(article_url)
    by_source_domain[source_domain] = by_source_domain.get(source_domain, 0) + 1


async def _record_discovered_links(
    outcome: dict[str, Any],
    *,
    seed_url: str,
    depth: int,
    store: Any,
    frontier_known_urls: set[str],
    existing_article_urls: set[str],
    domain_saved_counts: dict[str, int],
    queued: set[str],
    queue: deque[tuple[str, str, int]],
    seen: set[str],
    max_save_per_domain: int | None,
    from_date: date | None,
    to_date: date | None,
    persist_frontier: bool,
    resume_frontier: bool,
) -> dict[str, int]:
    counters = _zero_counters()
    priority_items: list[tuple[str, str, int]] = []
    discovery_items: list[tuple[str, str, int]] = []
    discovered_this_page: set[str] = set()
    links = outcome.get("discovered_links")
    for link in links if isinstance(links, list) else []:
        normalized = _normalized_discovered_url(str(link))
        if article_crawl_url_outside_date_window(normalized, from_date=from_date, to_date=to_date):
            counters["pruned_by_date"] += 1
            continue
        if normalized in existing_article_urls:
            counters["skipped_existing"] += 1
            continue
        if article_crawl_domain_at_cap(
            urlparse(normalized).netloc.lower(),
            domain_saved_counts,
            max_save_per_domain=max_save_per_domain,
        ):
            counters["skipped_by_domain_cap"] += 1
            continue
        if normalized in seen or normalized in queued or normalized in discovered_this_page:
            continue
        discovered_this_page.add(normalized)
        crawl_item = (normalized, seed_url, depth + 1)
        if article_crawl_is_discovery_resource(normalized):
            discovery_items.append(crawl_item)
        else:
            priority_items.append(crawl_item)
    return await _persist_or_enqueue_discovered_items(
        priority_items,
        discovery_items,
        store=store,
        frontier_known_urls=frontier_known_urls,
        queued=queued,
        queue=queue,
        persist_frontier=persist_frontier,
        resume_frontier=resume_frontier,
        counters=counters,
    )


async def _persist_or_enqueue_discovered_items(
    priority_items: list[tuple[str, str, int]],
    discovery_items: list[tuple[str, str, int]],
    *,
    store: Any,
    frontier_known_urls: set[str],
    queued: set[str],
    queue: deque[tuple[str, str, int]],
    persist_frontier: bool,
    resume_frontier: bool,
    counters: dict[str, int],
) -> dict[str, int]:
    all_items = [*priority_items, *discovery_items]
    if not (resume_frontier and persist_frontier):
        for item_url, _item_seed_url, _item_depth in all_items:
            queued.add(item_url)
            counters["enqueued"] += 1
        if priority_items:
            queue.extendleft(reversed(priority_items))
        queue.extend(discovery_items)
    if persist_frontier:
        frontier_save = await store.upsert_article_frontier(
            [
                article_frontier_item(url=item_url, seed_url=item_seed_url, depth=item_depth)
                for item_url, item_seed_url, item_depth in all_items
            ]
        )
        counters["frontier_saved"] += frontier_save["saved"]
        counters["frontier_skipped"] += frontier_save["skipped"]
        frontier_known_urls.update(item_url for item_url, _item_seed_url, _item_depth in all_items)
    return counters


def _normalized_discovered_url(url: str) -> str:
    normalized = normalize_url(url)
    if article_crawl_is_discovery_resource(normalized):
        return normalized
    return canonicalize_article_url(normalized)


def _zero_counters() -> dict[str, int]:
    return {
        "filtered": 0,
        "pruned_by_date": 0,
        "skipped_existing": 0,
        "skipped_by_domain_cap": 0,
        "frontier_saved": 0,
        "frontier_skipped": 0,
        "enqueued": 0,
    }
