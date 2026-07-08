"""Shared helpers for Scout pipeline branch tests."""

from __future__ import annotations

from atlas_shared import PageContent

from atlas_scout.providers.base import Completion, Message


class _SeedFetcher:
    """A fetcher that returns a single PageContent for any URL."""

    def __init__(self, *, fetched_urls: list[str] | None = None) -> None:
        self.fetched_urls: list[str] = fetched_urls if fetched_urls is not None else []

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
        self.fetched_urls.append(url)
        return PageContent(
            url=url,
            title="Seed",
            text=("Tenant Defense Collective organizes tenants locally in Austin. " * 60),
            task_id=task_id,
        )


class _EmptyProvider:
    """LLM provider that always returns an empty extraction."""

    max_concurrent = 1

    async def complete(
        self,
        _messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        return Completion(text="[]")


class _FlakyProgressProvider:
    """Provider that returns []; tests use a flaky on_progress callback."""

    max_concurrent = 1

    async def complete(
        self,
        _messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        return Completion(text="[]")


class _CrossDomainLinkFetcher:
    """Returns a seed page that points to a cross-domain link, plus a blank URL."""

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url == "https://example.com/seed":
            return {
                "url": url,
                "task_id": task_id,
                "page": PageContent(
                    url=url,
                    title="Seed",
                    text=("Local tenant defense organizers are active. " * 80),
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                # Includes a cross-domain link (skipped) and a blank URL (skipped),
                # plus a same-domain link to validate the queue path.
                "discovered_links": [
                    "https://other-domain.example/news",
                    "   ",
                    "https://example.com/article",
                ],
            }
        return {
            "url": url,
            "task_id": task_id,
            "page": PageContent(
                url=url,
                title="Article",
                text=("Article content " * 80),
                task_id=task_id,
            ),
            "status": "fetched",
            "error": None,
            "discovered_links": [],
        }


class _SameDomainHeavyLinkFetcher:
    """Seed page whose discovered_links exceed max_pages_per_seed to exercise quota."""

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url == "https://example.com/seed":
            return {
                "url": url,
                "task_id": task_id,
                "page": PageContent(
                    url=url,
                    title="Seed",
                    text=("Seed content " * 80),
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [f"https://example.com/article-{i}" for i in range(5)],
            }
        return {
            "url": url,
            "task_id": task_id,
            "page": PageContent(
                url=url,
                title="Article",
                text=("Article content " * 80),
                task_id=task_id,
            ),
            "status": "fetched",
            "error": None,
            "discovered_links": [],
        }


class _RaisingFetcher:
    """Fetcher whose fetch_tracked_verbose call always raises."""

    async def fetch_tracked_verbose(self, _url: str, _task_id: str, _store):
        raise RuntimeError("network exploded")


class _DiscoveredLinkRaisingFetcher:
    """Seed succeeds but the discovered link fetch raises an exception."""

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url == "https://example.com/seed":
            return {
                "url": url,
                "task_id": task_id,
                "page": PageContent(
                    url=url,
                    title="Seed",
                    text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                    task_id=task_id,
                    discovered_links=["https://example.com/article"],
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": ["https://example.com/article"],
            }
        raise RuntimeError("link fetch exploded")


class _DiscoveredLinkFilteredFetcher:
    """Seed succeeds but the discovered link fetch returns a filtered (non-Content) outcome."""

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url == "https://example.com/seed":
            return {
                "url": url,
                "task_id": task_id,
                "page": PageContent(
                    url=url,
                    title="Seed",
                    text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                    task_id=task_id,
                    discovered_links=["https://example.com/article"],
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": ["https://example.com/article"],
            }
        return {
            "url": url,
            "task_id": task_id,
            "page": None,
            "status": "filtered",
            "error": "blocked_by_robots_txt",
            "discovered_links": [],
        }


class _FilteredHubWithMixedLinksFetcher:
    """Seed returns filtered (non-Content) AND has cross-domain + duplicate links."""

    def __init__(self) -> None:
        self.calls = 0

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.calls += 1
        if url == "https://example.com/hub":
            return {
                "url": url,
                "task_id": task_id,
                "page": None,
                "status": "filtered",
                "error": "content_below_min_words",
                "discovered_links": [
                    "https://example.com/dup",
                    "https://example.com/dup",  # second pass should be already-seen
                    "https://other-domain.example/cross",
                    "https://example.com/article",
                ],
            }
        if url == "https://example.com/article":
            return {
                "url": url,
                "task_id": task_id,
                "page": PageContent(
                    url=url,
                    title="Article",
                    text=("Article content " * 80),
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
            }
        return {
            "url": url,
            "task_id": task_id,
            "page": PageContent(
                url=url,
                title="Dup",
                text=("Dup content " * 80),
                task_id=task_id,
            ),
            "status": "fetched",
            "error": None,
            "discovered_links": [],
        }


class _FilteredHubWithDuplicateLinksFetcher:
    """Filtered hub with two identical discovered links, exercising the dedupe-in-loop path."""

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url == "https://example.com/hub":
            return {
                "url": url,
                "task_id": task_id,
                "page": None,
                "status": "filtered",
                "error": "content_below_min_words",
                "discovered_links": [
                    "https://example.com/dup",
                    "https://example.com/dup",
                ],
            }
        return {
            "url": url,
            "task_id": task_id,
            "page": PageContent(
                url=url,
                title="Dup",
                text=("Dup content " * 80),
                task_id=task_id,
            ),
            "status": "fetched",
            "error": None,
            "discovered_links": [],
        }


class _PlainFetchFetcher:
    """Fetcher that exposes only the basic .fetch() coroutine (no tracked variants)."""

    async def fetch(self, url: str) -> PageContent | None:
        return PageContent(
            url=url,
            title="Plain",
            text=("Plain seed content " * 80),
        )


class _PlainFetchNoneFetcher:
    """Bare fetcher that returns None for every URL (exercises plain-fetch None branch)."""

    async def fetch(self, _url: str) -> PageContent | None:
        return None


class _BadVerboseThenTracked(_SeedFetcher):
    """Fetcher whose verbose method returns a non-dict, forcing fallback to fetch_tracked."""

    async def fetch_tracked_verbose(self, _url: str, _task_id: str, _store):
        return None  # not a dict — pipeline must skip and try fetch_tracked


class _BindAsyncFetcher(_SeedFetcher):
    """Fetcher whose bind_run is an async coroutine method."""

    def __init__(self) -> None:
        super().__init__()
        self.bound_runs: list[str] = []

    async def bind_run(self, run_id: str) -> None:
        self.bound_runs.append(run_id)
