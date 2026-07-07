"""Fetch-outcome normalization and search-frontier production for the pipeline."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, Protocol

from atlas_scout.pipeline_support import normalize_url
from atlas_scout.steps import source_fetch

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable

    from atlas_shared import PageContent

    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore


class EnqueueUrl(Protocol):
    """Async URL enqueue callback used by search frontier producers."""

    def __call__(
        self,
        url: str,
        *,
        depth: int,
        seed_url: str,
        discovered_from: str | None,
    ) -> Awaitable[bool]:
        """Enqueue a normalized URL for later fetching."""


class SearchProvider(Protocol):
    """Async web-search callable used by search frontier producers."""

    def __call__(
        self,
        queries: list[str],
        api_key: str,
        results_per_query: int = 5,
        *,
        country: str = "",
        freshness: str = "",
    ) -> Awaitable[list[dict[str, str | None]]]:
        """Search the given queries and return flat result metadata."""


async def fetch_outcome(
    fetcher: AsyncFetcher,
    *,
    url: str,
    task_id: str,
    store: ScoutStore,
) -> dict[str, Any]:
    """Call the most capable tracked-fetch method the fetcher exposes."""
    if hasattr(fetcher, "fetch_tracked_verbose"):
        outcome = await fetcher.fetch_tracked_verbose(url, task_id, store)
        if isinstance(outcome, dict):
            return outcome

    if hasattr(fetcher, "fetch_tracked"):
        page = await fetcher.fetch_tracked(url, task_id, store)
        return {
            "url": url,
            "task_id": task_id,
            "page": page,
            "status": "fetched" if page is not None else "filtered",
            "error": None if page is not None else "content_not_extractable",
            "discovered_links": page.discovered_links if page is not None else [],
        }

    page = await fetcher.fetch(url)
    if page is not None:
        page = page.model_copy(update={"task_id": task_id})
    return {
        "url": url,
        "task_id": task_id,
        "page": page,
        "status": "fetched" if page is not None else "filtered",
        "error": None if page is not None else "content_not_extractable",
        "discovered_links": page.discovered_links if page is not None else [],
    }


async def produce_search_frontier(
    *,
    queries: list[str],
    search_api_key: str,
    enqueue: EnqueueUrl,
    max_concurrent: int,
    results_per_query: int = 5,
    search: SearchProvider | None = None,
) -> None:
    """Search queries concurrently and enqueue unique result URLs as they arrive."""
    # Resolved at call time (not bound as a default) so callers can still patch
    # atlas_scout.steps.source_fetch.search_brave and have it take effect here.
    search_fn = search or source_fetch.search_brave
    semaphore = asyncio.Semaphore(max(1, max_concurrent))

    async def _search_one(query: str) -> list[dict[str, str | None]]:
        async with semaphore:
            return await search_fn([query], search_api_key, results_per_query=results_per_query)

    tasks = [asyncio.create_task(_search_one(query)) for query in queries]
    for task in asyncio.as_completed(tasks):
        results = await task
        for result in results:
            url = result.get("url")
            if isinstance(url, str) and url:
                normalized = normalize_url(url)
                if normalized:
                    await enqueue(
                        normalized,
                        depth=0,
                        seed_url=normalized,
                        discovered_from=None,
                    )


async def iter_items[Item](items: list[Item]) -> AsyncIterator[Item]:
    """Yield items from a plain list as an async iterator."""
    for item in items:
        yield item


def page_with_structured_columns(
    page: PageContent,
    structured_columns: list[str] | None,
) -> PageContent:
    """Attach operator-provided structured columns to a fetched page."""
    if not structured_columns:
        return page
    structured_data = dict(page.structured_data)
    structured_data["structured_columns"] = structured_columns
    return page.model_copy(update={"structured_data": structured_data})
