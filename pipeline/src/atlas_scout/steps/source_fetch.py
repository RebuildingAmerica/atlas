"""
Step 2: Source Fetching.

Searches via Brave Search API and fetches pages, yielding as an async generator.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import httpx

from atlas_shared import PageContent
from atlas_scout.scraper.fetcher import AsyncFetcher
from atlas_scout.steps.query_gen import SearchQuery

logger = logging.getLogger(__name__)

__all__ = ["fetch_sources_stream"]

_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


async def fetch_sources_stream(
    queries: list[SearchQuery] | AsyncIterator[SearchQuery],
    fetcher: AsyncFetcher,
    search_api_key: str,
) -> AsyncIterator[PageContent]:
    """
    Search Brave API for each query, fetch result pages, and yield as they complete.

    Parameters
    ----------
    queries : list[SearchQuery] | AsyncIterator[SearchQuery]
        Queries to execute — either a plain list or an async generator.
    fetcher : AsyncFetcher
        Async HTTP fetcher for page content.
    search_api_key : str
        Brave Search API subscription token.

    Yields
    ------
    PageContent
        Fetched page contents, in completion order.
    """
    # Collect all queries (handle both list and async iterator)
    query_list: list[SearchQuery]
    if isinstance(queries, list):
        query_list = queries
    else:
        query_list = [q async for q in queries]

    # Search and collect unique URLs
    query_strings = [q.query for q in query_list]
    search_results = await _search_brave(query_strings, search_api_key)

    seen_urls: set[str] = set()
    unique_urls: list[str] = []
    for result in search_results:
        url = result.get("url")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_urls.append(url)

    if not unique_urls:
        return

    # Fan out fetches with asyncio.as_completed for streaming
    loop = asyncio.get_event_loop()
    futures = [loop.create_task(fetcher.fetch(url)) for url in unique_urls]

    for coro in asyncio.as_completed(futures):
        page = await coro
        if page is not None:
            yield page


async def _search_brave(
    queries: list[str],
    api_key: str,
    results_per_query: int = 5,
) -> list[dict[str, str | None]]:
    """
    Execute web searches using Brave Search.

    Parameters
    ----------
    queries : list[str]
        Search query strings.
    api_key : str
        Brave Search subscription token.
    results_per_query : int
        Number of results to fetch per query (default: 5).

    Returns
    -------
    list[dict[str, str | None]]
        Flat list of search result metadata dicts with ``url``, ``title``,
        and ``publication`` keys.
    """
    headers = {
        "Accept": "application/json",
        "X-Subscription-Token": api_key,
    }
    results: list[dict[str, str | None]] = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        for query in queries:
            try:
                response = await client.get(
                    _BRAVE_SEARCH_URL,
                    params={"q": query, "count": results_per_query},
                    headers=headers,
                )
                response.raise_for_status()
                payload = response.json()
                results.extend(
                    {
                        "url": item.get("url"),
                        "title": item.get("title"),
                        "publication": item.get("profile", {}).get("name"),
                    }
                    for item in payload.get("web", {}).get("results", [])
                )
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                logger.warning("Brave search failed for %r: %s", query, exc)

    return results
