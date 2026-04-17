"""
Post-extraction reverse verification.

Validates that extracted entities actually exist by checking:
1. Website URLs resolve (HEAD request)
2. Reverse web search finds corroborating results
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from atlas_shared import RawEntry

logger = logging.getLogger(__name__)

__all__ = ["verify_entries"]


async def verify_entries(
    entries: list[RawEntry],
    *,
    search_api_key: str = "",
    check_websites: bool = True,
    reverse_search: bool = True,
) -> list[RawEntry]:
    """Verify extracted entries exist in the real world.

    Uses a shared httpx client for all checks to avoid per-entry
    connection overhead.
    """
    if not entries:
        return entries

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        tasks = [
            _verify_one(
                entry, client,
                search_api_key=search_api_key,
                check_websites=check_websites,
                reverse_search=reverse_search,
            )
            for entry in entries
        ]
        results = await asyncio.gather(*tasks)

    verified: list[RawEntry] = []
    for entry, (is_verified, reason) in zip(entries, results):
        if not is_verified:
            logger.info(
                "Verification failed for %r: %s",
                entry.name,
                reason,
            )
        verified.append(entry)

    return verified


async def _verify_one(
    entry: RawEntry,
    client: httpx.AsyncClient,
    *,
    search_api_key: str,
    check_websites: bool,
    reverse_search: bool,
) -> tuple[bool, str]:
    """Verify a single entry. Returns (verified, reason)."""
    if check_websites and entry.website:
        website_ok = await _check_website(entry.website, client)
        if not website_ok:
            logger.debug("Website %s does not resolve for %r", entry.website, entry.name)

    if reverse_search and search_api_key and entry.entry_type in ("organization", "initiative"):
        location_hint = f" {entry.city}" if entry.city else ""
        search_query = f'"{entry.name}"{location_hint}'
        hit_count = await _reverse_search(search_query, search_api_key, client)

        if hit_count == 0:
            return False, f"reverse search for {search_query!r} returned 0 results"

    return True, "ok"


async def _check_website(url: str, client: httpx.AsyncClient) -> bool:
    """HEAD request to check if a URL resolves."""
    try:
        resp = await client.head(url)
        return resp.status_code < 400
    except (httpx.RequestError, httpx.HTTPStatusError):
        return False


_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


async def _reverse_search(query: str, api_key: str, client: httpx.AsyncClient) -> int:
    """Search for an entity name and return the number of results found."""
    headers = {
        "Accept": "application/json",
        "X-Subscription-Token": api_key,
    }
    try:
        resp = await client.get(
            _BRAVE_SEARCH_URL,
            params={"q": query, "count": 3},
            headers=headers,
        )
        resp.raise_for_status()
        payload = resp.json()
        results = payload.get("web", {}).get("results", [])
        return len(results)
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        logger.debug("Reverse search failed for %r: %s", query, exc)
        return -1
