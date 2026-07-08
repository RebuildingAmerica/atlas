"""Shared helpers for fetcher tests."""

from __future__ import annotations

from typing import Any

from atlas_shared import PageContent, SourceType


def article_html(snippet: str, *, repeats: int = 55) -> str:
    return "<html><body><article><p>" + snippet * repeats + "</p></article></body></html>"


def shell_html() -> str:
    return "<html><body><div id='root'></div><script src='/app.js'></script></body></html>"


def sparse_roster_html() -> str:
    return "<html><body>shell</body></html>"


class _FakeStore:
    """Stand-in for ScoutStore exercising the claim/cache path."""

    def __init__(
        self,
        *,
        cached: dict[str, Any] | None = None,
        cached_after_first_call: dict[str, Any] | None = None,
        claim_returns: list[bool] | None = None,
        get_work_claim_returns: list[dict[str, Any] | None] | None = None,
    ) -> None:
        self._cached_initial = cached
        self._cached_after = cached_after_first_call
        self._cache_calls = 0
        self._claim_returns = list(claim_returns or [True])
        self._claim_idx = 0
        self._gwc = list(get_work_claim_returns or [])
        self._gwc_idx = 0
        self.completed: list[str] = []
        self.failed: list[tuple[str, str]] = []
        self.cache_calls: list[tuple[str, str, dict[str, Any]]] = []

    async def get_cached_page(self, url: str, ttl_days: int | None = 7) -> dict[str, Any] | None:
        del url, ttl_days
        self._cache_calls += 1
        if self._cache_calls == 1:
            return self._cached_initial
        return self._cached_after

    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None:
        self.cache_calls.append((url, text, metadata))

    async def claim_work(self, key: str, *, owner_run_id: str, lease_seconds: int = 120) -> bool:
        del key, owner_run_id, lease_seconds
        if self._claim_idx >= len(self._claim_returns):
            return False
        value = self._claim_returns[self._claim_idx]
        self._claim_idx += 1
        return value

    async def complete_work(self, key: str) -> None:
        self.completed.append(key)

    async def fail_work(self, key: str, error: str) -> None:
        self.failed.append((key, error))

    async def get_work_claim(self, key: str) -> dict[str, Any] | None:
        del key
        if self._gwc_idx >= len(self._gwc):
            return None
        value = self._gwc[self._gwc_idx]
        self._gwc_idx += 1
        return value


def rendered_news_page() -> PageContent:
    return PageContent(
        url="https://news.example.com/local/civic-story",
        text="Rendered story names a local civic leader and organization. " * 80,
        title="Rendered civic story",
        source_type=SourceType.NEWS_ARTICLE,
        discovered_links=["https://news.example.com/local/follow-up"],
    )


def rendered_roster_page() -> PageContent:
    return PageContent(
        url="https://example.gov/government/mayor-city-council",
        text="\n".join(
            [
                "Shelley Berkley",
                "Mayor",
                "Brian Knudsen",
                "Councilman Ward 1",
            ]
        ),
        title="Mayor and City Council",
        discovered_links=["https://example.gov/government/mayor"],
    )


def sparse_roster_page() -> PageContent:
    return PageContent(
        url="https://example.gov/government/mayor-city-council",
        text="\n".join(
            [
                "Mayor and City Council positions are elected by registered voters.",
                "Mayor",
                "Councilman Ward 1",
                "Councilwoman Ward 2",
            ]
        ),
        title="Mayor and City Council",
    )
