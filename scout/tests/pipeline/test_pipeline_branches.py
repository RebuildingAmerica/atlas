"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message

if TYPE_CHECKING:
    from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Progress callback exception path (lines 145-146)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_swallows_progress_callback_exceptions(tmp_db_path: Path) -> None:
    """A raising on_progress callback must not crash the pipeline."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    def boom(_event: str, _payload: dict[str, object]) -> None:
        raise RuntimeError("on_progress exploded")

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_FlakyProgressProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SeedFetcher(),
        on_progress=boom,
    )

    # The run still completes despite every progress event raising.
    assert result.run_id is not None
    await store.close()


# ---------------------------------------------------------------------------
# enqueue_url early-return paths (lines 157, 161, 168)
# ---------------------------------------------------------------------------


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


@pytest.mark.asyncio
async def test_run_pipeline_skips_cross_domain_and_blank_links(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_CrossDomainLinkFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = {task["url"] for task in page_tasks}
    assert "https://example.com/seed" in queued_urls
    assert "https://example.com/article" in queued_urls
    assert "https://other-domain.example/news" not in queued_urls
    await store.close()


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


@pytest.mark.asyncio
async def test_run_pipeline_respects_max_pages_per_seed(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SameDomainHeavyLinkFetcher(),
        max_pages_per_seed=2,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    # Only 2 page tasks should exist due to max_pages_per_seed=2.
    assert len(page_tasks) == 2
    await store.close()


# ---------------------------------------------------------------------------
# Fetch worker exception path (lines 417-431)
# ---------------------------------------------------------------------------


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


@pytest.mark.asyncio
async def test_run_pipeline_skips_page_failed_emit_for_non_visible_link_fetch_failures(
    tmp_db_path: Path,
) -> None:
    """When a discovered (non-root) link fetch raises, fetch_failed is emitted but
    page_failed is NOT (the task isn't user-visible at that point)."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_DiscoveredLinkRaisingFetcher(),
        on_progress=on_progress,
    )

    fetch_failed_payloads = [payload for name, payload in events if name == "fetch_failed"]
    assert any(
        payload.get("url") == "https://example.com/article" for payload in fetch_failed_payloads
    )
    page_failed_payloads = [payload for name, payload in events if name == "page_failed"]
    # The seed never fails, and the article task is non-visible at the time of failure.
    assert all(
        payload.get("url") != "https://example.com/article" for payload in page_failed_payloads
    )
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_skips_page_skipped_emit_for_non_visible_link_filtered_fetch(
    tmp_db_path: Path,
) -> None:
    """When a discovered link fetch returns a filtered outcome, fetch_skipped fires
    but page_skipped is suppressed because the task isn't user-visible yet."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_DiscoveredLinkFilteredFetcher(),
        on_progress=on_progress,
    )

    fetch_skipped_payloads = [payload for name, payload in events if name == "fetch_skipped"]
    assert any(
        payload.get("url") == "https://example.com/article" for payload in fetch_skipped_payloads
    )
    page_skipped_payloads = [payload for name, payload in events if name == "page_skipped"]
    # The article was a discovered link, not user-visible → page_skipped suppressed.
    assert all(
        payload.get("url") != "https://example.com/article" for payload in page_skipped_payloads
    )
    await store.close()


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


@pytest.mark.asyncio
async def test_run_pipeline_filtered_hub_dedupes_repeated_links_in_loop(
    tmp_db_path: Path,
) -> None:
    """A filtered hub whose discovered_links contains the same URL twice should
    only queue it once — the second iteration goes through the `if queued: False`
    branch."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/hub"],
        fetcher=_FilteredHubWithDuplicateLinksFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = [task["url"] for task in page_tasks]
    # The duplicate should appear exactly once.
    assert queued_urls.count("https://example.com/dup") == 1
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_follows_links_from_filtered_hub_with_mixed_link_kinds(
    tmp_db_path: Path,
) -> None:
    """Filtered (non-Content) hub with duplicate, cross-domain, and unique links
    should queue only the unique same-domain link."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    fetcher = _FilteredHubWithMixedLinksFetcher()
    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/hub"],
        fetcher=fetcher,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = {task["url"] for task in page_tasks}
    assert "https://example.com/hub" in queued_urls
    assert "https://example.com/dup" in queued_urls
    assert "https://example.com/article" in queued_urls
    # Cross-domain link should never be queued.
    assert "https://other-domain.example/cross" not in queued_urls
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_records_fetch_exceptions(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_RaisingFetcher(),
        on_progress=on_progress,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert page_tasks[0]["status"] == "fetch_failed"
    failure_payload = next(payload for name, payload in events if name == "fetch_failed")
    assert "network exploded" in str(failure_payload["reason"])
    page_failed_payload = next(payload for name, payload in events if name == "page_failed")
    assert "network exploded" in str(page_failed_payload["reason"])
    await store.close()


# ---------------------------------------------------------------------------
# Search mode missing api key (line 584)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_skips_malformed_search_results(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Malformed search-result rows (None url, blank url, non-string url) are skipped."""
    from atlas_scout.store import ScoutStore

    async def _fake_search(_queries, _key, **_kwargs):
        return [
            {"url": None},
            {"url": ""},
            {"url": 12345},
            {"url": "   "},
            {"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"},
        ]

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = {task["url"] for task in page_tasks}
    assert queued_urls == {"https://example.com/seed"}
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_place_issue_run_requires_search_or_local_articles(
    tmp_db_path: Path,
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    with pytest.raises(ValueError, match="Connect search or build a local article corpus"):
        await run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=_EmptyProvider(),
            store=store,
            search_api_key="",
        )

    runs = await store.list_runs()
    assert runs[0]["status"] == "failed"
    await store.close()


# ---------------------------------------------------------------------------
# bind_run async branch (115->118)
# ---------------------------------------------------------------------------


class _BindAsyncFetcher(_SeedFetcher):
    """Fetcher whose bind_run is an async coroutine method."""

    def __init__(self) -> None:
        super().__init__()
        self.bound_runs: list[str] = []

    async def bind_run(self, run_id: str) -> None:
        self.bound_runs.append(run_id)


@pytest.mark.asyncio
async def test_run_pipeline_awaits_async_bind_run(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    fetcher = _BindAsyncFetcher()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=fetcher,
    )

    assert fetcher.bound_runs == [result.run_id]
    await store.close()


# ---------------------------------------------------------------------------
# Fallback fetch path in _fetch_outcome (lines 950-953)
# ---------------------------------------------------------------------------


class _PlainFetchFetcher:
    """Fetcher that exposes only the basic .fetch() coroutine (no tracked variants)."""

    async def fetch(self, url: str) -> PageContent | None:
        return PageContent(
            url=url,
            title="Plain",
            text=("Plain seed content " * 80),
        )


@pytest.mark.asyncio
async def test_run_pipeline_skips_blank_direct_url_entries(
    tmp_db_path: Path,
) -> None:
    """Blank direct URLs are normalized to empty strings and skipped without crashing."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["   ", "https://example.com/seed"],
        fetcher=_SeedFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert len(page_tasks) == 1
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_falls_back_to_plain_fetch_when_no_tracked_methods(
    tmp_db_path: Path,
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/plain"],
        fetcher=_PlainFetchFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    # Status progresses through fetched → extracted/extract_empty by the time the
    # run finishes; what matters is that the page task was successfully processed.
    assert page_tasks[0]["status"] in {"fetched", "extracted", "extract_empty"}
    await store.close()


class _PlainFetchNoneFetcher:
    """Bare fetcher that returns None for every URL (exercises plain-fetch None branch)."""

    async def fetch(self, _url: str) -> PageContent | None:
        return None


@pytest.mark.asyncio
async def test_run_pipeline_plain_fetch_returns_none_filters_task(
    tmp_db_path: Path,
) -> None:
    """Plain fetch returning None marks the page task filtered without crashing."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/missing"],
        fetcher=_PlainFetchNoneFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert page_tasks[0]["status"] == "filtered"
    await store.close()


# ---------------------------------------------------------------------------
# fetch_tracked_verbose returning non-dict falls through to fetch_tracked (branch 919->922)
# ---------------------------------------------------------------------------


class _BadVerboseThenTracked(_SeedFetcher):
    """Fetcher whose verbose method returns a non-dict, forcing fallback to fetch_tracked."""

    async def fetch_tracked_verbose(self, _url: str, _task_id: str, _store):
        return None  # not a dict — pipeline must skip and try fetch_tracked


@pytest.mark.asyncio
async def test_run_pipeline_falls_back_to_fetch_tracked_when_verbose_returns_non_dict(
    tmp_db_path: Path,
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_BadVerboseThenTracked(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    # Status progresses through fetched → extracted/extract_empty by the time the
    # run finishes; what matters is that the page task was successfully processed.
    assert page_tasks[0]["status"] in {"fetched", "extracted", "extract_empty"}
    await store.close()


# ---------------------------------------------------------------------------
# own_fetcher close path (lines 920-922)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_closes_default_fetcher_when_owned(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    closed_runs: list[str] = []

    class _OwnedFetcher:
        max_concurrent = 1

        def __init__(self, *, store, run_id: str) -> None:
            self.store = store
            self.run_id = run_id

        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Owned",
                text=("Owned seed content " * 80),
                task_id=task_id,
            )

        async def close(self) -> None:
            closed_runs.append(self.run_id)

    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", _OwnedFetcher)

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        # No fetcher passed → pipeline owns the default and must close it.
    )

    assert closed_runs == [result.run_id]
    await store.close()


# ---------------------------------------------------------------------------
# Contribution config: artifacts present and contribution succeeds (lines 845-868)
# ---------------------------------------------------------------------------
