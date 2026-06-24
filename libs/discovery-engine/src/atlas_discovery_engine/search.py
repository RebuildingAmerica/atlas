"""Vendor-neutral search provider abstraction.

Discovery needs web search, but the vendor behind it must be swappable: a rate
limit or outage at one provider should degrade gracefully into fewer results or
a fallback vendor, never zero out a city. This module defines the contract
(``SearchProvider``) and the normalized result shape (``SearchResult``) that
both Scout and the API worker depend on, so search becomes a pluggable seam
rather than an inline coupling to one vendor.
"""

from __future__ import annotations

import asyncio
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

__all__ = [
    "BraveSearchProvider",
    "FallbackSearchProvider",
    "SearchProvider",
    "SearchResult",
    "StaticSearchProvider",
]

logger = logging.getLogger(__name__)

_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

SleepFn = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class SearchResult:
    """A single normalized web search result.

    Parameters
    ----------
    url : str
        The result's canonical URL.
    title : str | None
        The result title, when the vendor supplies one.
    publication : str | None
        The publishing outlet/profile name, when known.
    published : str | None
        The publication date as an ISO date string, or None when unknown.
    """

    url: str
    title: str | None
    publication: str | None
    published: str | None


class SearchProvider(ABC):
    """The contract every concrete search vendor adapter must satisfy."""

    @abstractmethod
    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        """Run each query and return normalized results.

        Implementations must not raise on a single query's transient failure;
        they degrade to fewer results so one bad query never zeroes out a run.

        Parameters
        ----------
        queries : Sequence[str]
            The raw query strings to execute.

        Returns
        -------
        list[SearchResult]
            Normalized results aggregated across the queries.
        """


def _parse_result_age(age_value: str | None) -> str | None:
    """Normalize a Brave result age into an ISO date when one is present.

    Parameters
    ----------
    age_value : str | None
        The raw ``age`` field Brave returns (sometimes an ISO date, sometimes a
        relative phrase like ``"3 days ago"``).

    Returns
    -------
    str | None
        The ISO date string when the value already looks like one, else None.
    """
    if not age_value:
        return None
    if _ISO_DATE.fullmatch(age_value):
        return age_value
    return None


class BraveSearchProvider(SearchProvider):
    """A Brave Search adapter hardened against rate limits and outages.

    Each query is executed independently; a single query's rate limit or
    transport failure skips that query and degrades to partial results rather
    than raising and zeroing out the whole run.
    """

    ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
    DEFAULT_RETRY_SECONDS = 1.0
    MAX_RETRY_SECONDS = 30.0

    def __init__(
        self,
        *,
        api_key: str,
        count: int = 5,
        timeout: float = 20.0,
        max_retries: int = 2,
        sleep: SleepFn | None = None,
    ) -> None:
        """Configure the Brave adapter.

        Parameters
        ----------
        api_key : str
            The Brave subscription token.
        count : int, optional
            Results requested per query. Default is 5.
        timeout : float, optional
            Per-request timeout in seconds. Default is 20.0.
        max_retries : int, optional
            Retries after the initial attempt when rate-limited. Default is 2.
        sleep : SleepFn | None, optional
            Awaitable sleep used between retries; defaults to ``asyncio.sleep``.
            Injectable so tests can run without real delays.
        """
        self._api_key = api_key
        self._count = count
        self._timeout = timeout
        self._max_retries = max_retries
        self._sleep = sleep or asyncio.sleep

    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        """Run each query against Brave, skipping any that fail transiently."""
        headers = {"Accept": "application/json", "X-Subscription-Token": self._api_key}
        results: list[SearchResult] = []
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for query in queries:
                results.extend(await self._search_one(client, query, headers))
        return results

    async def _search_one(
        self,
        client: httpx.AsyncClient,
        query: str,
        headers: dict[str, str],
    ) -> list[SearchResult]:
        """Execute a single query with bounded rate-limit retries."""
        for attempt in range(self._max_retries + 1):
            try:
                response = await client.get(
                    self.ENDPOINT,
                    params={"q": query, "count": self._count},
                    headers=headers,
                )
                response.raise_for_status()
                return self._map_payload(response.json())
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code != httpx.codes.TOO_MANY_REQUESTS:
                    logger.warning("Brave search failed for query %r: %s", query, exc)
                    return []
                if attempt == self._max_retries:
                    logger.warning("Brave search rate-limited for query %r; skipping", query)
                    return []
                await self._sleep(self._retry_delay(exc.response))
            except httpx.RequestError as exc:
                logger.warning("Brave search request error for query %r: %s", query, exc)
                return []
        return []  # pragma: no cover - loop always returns inside the body

    def _retry_delay(self, response: httpx.Response) -> float:
        """Derive a bounded retry delay from a 429's Retry-After header."""
        raw = response.headers.get("Retry-After")
        try:
            seconds = float(raw) if raw is not None else self.DEFAULT_RETRY_SECONDS
        except ValueError:
            seconds = self.DEFAULT_RETRY_SECONDS
        return min(seconds, self.MAX_RETRY_SECONDS)

    @staticmethod
    def _map_payload(payload: dict[str, Any]) -> list[SearchResult]:
        """Map a Brave web-search payload into normalized SearchResults."""
        mapped: list[SearchResult] = []
        for item in payload.get("web", {}).get("results", []):
            url = item.get("url")
            if not url:
                continue
            mapped.append(
                SearchResult(
                    url=url,
                    title=item.get("title"),
                    publication=item.get("profile", {}).get("name"),
                    published=_parse_result_age(item.get("age")),
                )
            )
        return mapped


class StaticSearchProvider(SearchProvider):
    """A no-network provider that returns a fixed result set.

    Useful as a concrete fallback in environments without a second vendor key,
    and as a seam that keeps the fallback composition real and testable.
    """

    def __init__(self, results: Sequence[SearchResult]) -> None:
        """Capture the canned results this provider always returns.

        Parameters
        ----------
        results : Sequence[SearchResult]
            The fixed results to emit for any non-empty query batch.
        """
        self._results = list(results)

    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        """Return the canned results, or nothing when there are no queries."""
        return list(self._results) if queries else []


class FallbackSearchProvider(SearchProvider):
    """Compose two providers so an outage at one degrades to the other.

    The primary is tried first; if it raises or returns no results, the
    fallback is tried. This gives the run a second chance to find sources for a
    city instead of zeroing it out when the primary vendor is down or empty.
    """

    def __init__(self, *, primary: SearchProvider, fallback: SearchProvider) -> None:
        """Wire the primary and fallback providers.

        Parameters
        ----------
        primary : SearchProvider
            The preferred provider, tried first.
        fallback : SearchProvider
            The provider used when the primary fails or comes back empty.
        """
        self._primary = primary
        self._fallback = fallback

    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        """Try the primary, then the fallback when it fails or finds nothing."""
        try:
            results = await self._primary.search(queries)
        except Exception as exc:
            logger.warning("Primary search provider failed; using fallback: %s", exc)
            return await self._fallback.search(queries)
        if results:
            return results
        logger.info("Primary search provider returned no results; using fallback")
        return await self._fallback.search(queries)
