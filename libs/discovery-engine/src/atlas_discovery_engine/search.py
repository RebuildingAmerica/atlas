"""Vendor-neutral search provider abstraction.

Discovery needs web search, but the vendor behind it must be swappable: a rate
limit or outage at one provider should degrade gracefully into fewer results or
a fallback vendor, never zero out a city. This module defines the contract
(``SearchProvider``) and the normalized result shape (``SearchResult``) that
both Scout and the API worker depend on, so search becomes a pluggable seam
rather than an inline coupling to one vendor.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass

__all__ = ["SearchProvider", "SearchResult"]


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
