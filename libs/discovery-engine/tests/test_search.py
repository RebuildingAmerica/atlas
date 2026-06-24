"""Tests for the vendor-neutral search provider abstraction."""

from __future__ import annotations

from collections.abc import Sequence

from atlas_discovery_engine.search import SearchProvider, SearchResult


class _StubProvider(SearchProvider):
    """A trivial in-memory provider proving the abstract contract."""

    def __init__(self, canned: list[SearchResult]) -> None:
        self._canned = canned

    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        return list(self._canned) if queries else []


class TestSearchProviderContract:
    """The ABC defines the contract concrete providers must honor."""

    async def test_concrete_provider_returns_canned_results(self) -> None:
        """A concrete subclass returns its results for non-empty queries."""
        canned = [
            SearchResult(
                url="https://example.com/story",
                title="Story",
                publication="Example News",
                published="2026-01-15",
            )
        ]
        provider = _StubProvider(canned)

        results = await provider.search(["housing"])

        assert results == canned

    async def test_concrete_provider_returns_empty_for_no_queries(self) -> None:
        """An empty query sequence yields no results."""
        provider = _StubProvider(
            [
                SearchResult(
                    url="https://example.com/story",
                    title="Story",
                    publication="Example News",
                    published="2026-01-15",
                )
            ]
        )

        assert await provider.search([]) == []
