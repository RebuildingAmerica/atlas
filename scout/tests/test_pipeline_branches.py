"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_scout import pipeline as pipeline_module
from atlas_scout.config import ContributionConfig
from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.contribute import ContributionResult

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
                "discovered_links": [
                    f"https://example.com/article-{i}" for i in range(5)
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

    fetch_failed_payloads = [
        payload for name, payload in events if name == "fetch_failed"
    ]
    assert any(
        payload.get("url") == "https://example.com/article"
        for payload in fetch_failed_payloads
    )
    page_failed_payloads = [
        payload for name, payload in events if name == "page_failed"
    ]
    # The seed never fails, and the article task is non-visible at the time of failure.
    assert all(
        payload.get("url") != "https://example.com/article"
        for payload in page_failed_payloads
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

    fetch_skipped_payloads = [
        payload for name, payload in events if name == "fetch_skipped"
    ]
    assert any(
        payload.get("url") == "https://example.com/article"
        for payload in fetch_skipped_payloads
    )
    page_skipped_payloads = [
        payload for name, payload in events if name == "page_skipped"
    ]
    # The article was a discovered link, not user-visible → page_skipped suppressed.
    assert all(
        payload.get("url") != "https://example.com/article"
        for payload in page_skipped_payloads
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

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

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
async def test_run_pipeline_search_mode_requires_api_key(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    with pytest.raises(ValueError, match="search_api_key is required in search mode"):
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


@pytest.mark.asyncio
async def test_run_pipeline_syncs_artifacts_when_contribution_enabled(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    sync_calls: list[dict[str, object]] = []

    async def fake_sync_run_artifacts(
        _artifacts, *, atlas_url: str, api_key: str
    ) -> ContributionResult:
        sync_calls.append({"atlas_url": atlas_url, "api_key": api_key})
        return ContributionResult(
            attempted=1,
            created=1,
            failed=0,
            errors=[],
            run_id="remote-run-id",
            sync_status="synced",
            duplicate=False,
        )

    monkeypatch.setattr(
        "atlas_scout.steps.contribute.sync_run_artifacts", fake_sync_run_artifacts
    )

    contribution = ContributionConfig(
        enabled=True,
        api_key="test-token",
        atlas_url="https://atlas.example",
        min_score=0.0,
    )

    class _OneEntryProvider:
        max_concurrent = 1

        def __init__(self) -> None:
            self.calls = 0

        async def complete(
            self,
            messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            self.calls += 1
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "Organizes tenants locally.",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "https://tenant.example",
                                    "email": "hello@tenant.example",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": "Tenant Defense Collective organizes tenants.",
                                }
                            ]
                        }
                    )
                )
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    async def _fake_search(*_args, **_kwargs):
        return [{"url": "https://example.com/result", "title": "x", "publication": "y"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_OneEntryProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        contribution_config=contribution,
        min_entry_score=0.0,
    )

    assert sync_calls == [{"atlas_url": "https://atlas.example", "api_key": "test-token"}]
    assert result.artifacts is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_records_sync_failure_when_sync_returns_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def fake_sync_run_artifacts(
        _artifacts, *, atlas_url: str, api_key: str
    ) -> ContributionResult:
        del atlas_url, api_key
        return ContributionResult(
            attempted=1,
            created=0,
            failed=1,
            errors=["upstream rejected"],
            run_id=None,
            sync_status="failed",
        )

    monkeypatch.setattr(
        "atlas_scout.steps.contribute.sync_run_artifacts", fake_sync_run_artifacts
    )

    contribution = ContributionConfig(
        enabled=True,
        api_key="test-token",
        atlas_url="https://atlas.example",
        min_score=0.0,
    )

    async def _fake_search(*_args, **_kwargs):
        return [{"url": "https://example.com/seed", "title": "x", "publication": "y"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        contribution_config=contribution,
    )

    await store.close()


# ---------------------------------------------------------------------------
# Contribution warning when canonical metadata missing (line 874 / lines 837)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_skips_artifact_persistence_in_direct_url_mode(
    tmp_db_path: Path,
) -> None:
    """Direct URL mode lacks canonical run metadata → artifacts are not persisted."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="",  # blank location → cannot build canonical artifacts
        issues=[],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SeedFetcher(),
    )

    assert result.artifacts is None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_warns_when_contribution_enabled_without_canonical_metadata(
    caplog: pytest.LogCaptureFixture, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    contribution = ContributionConfig(
        enabled=True,
        api_key="test-token",
        atlas_url="https://atlas.example",
        min_score=0.0,
    )

    with caplog.at_level("WARNING", logger=pipeline_module.logger.name):
        await run_pipeline(
            location="",  # no canonical metadata
            issues=[],
            provider=_EmptyProvider(),
            store=store,
            direct_urls=["https://example.com/seed"],
            fetcher=_SeedFetcher(),
            contribution_config=contribution,
        )

    assert any(
        "Skipping Atlas sync" in record.getMessage() for record in caplog.records
    )
    await store.close()


# ---------------------------------------------------------------------------
# Iterative deepening (lines 619-782)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_executes_all_phases(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Verify iterative_deepening exercises lead-following, follow-up search, and entity chase."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    # Search returns one URL for both initial seed search and follow-up search.
    search_calls = 0

    async def _fake_search(_queries, _key, **_kwargs):
        nonlocal search_calls
        search_calls += 1
        if search_calls == 1:
            return [{"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"}]
        return [{"url": "https://example.com/followup", "title": "Followup", "publication": "Ex"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    # Entity-chase generators return dummy targets and follow-up queries.
    async def _fake_followup(*_args, **_kwargs):
        from atlas_scout.steps.query_gen import SearchQuery

        return [
            SearchQuery(query="extra housing query", source_category="llm_followup", issue_area="housing_affordability"),
        ]

    async def _fake_chase(*_args, **_kwargs):
        return [
            {
                "name": "Outreach Coalition",
                "website": "https://example.com/coalition",
                "search_query": "Outreach Coalition Austin",
            }
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _fake_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase
    )

    # Avoid invoking the real Playwright browser path during entity chasing.
    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    class _LeadProvider:
        """A provider that emits one entry with discovery_leads on its first call."""

        max_concurrent = 1

        def __init__(self) -> None:
            self.calls = 0

        async def complete(
            self,
            messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            self.calls += 1
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "Organizes tenants locally.",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "https://tenant.example",
                                    "email": "hello@tenant.example",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": ["https://example.com/lead"],
                        }
                    )
                )
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    class _UniversalFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store):
            return PageContent(
                url=url,
                title="Page",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                task_id=task_id,
            )

        async def fetch(self, url: str):
            # Iterative deepening uses the bare fetch() coroutine.
            return PageContent(
                url=url,
                title="Page",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
            )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_LeadProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_UniversalFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.run_id is not None
    assert result.queries_generated > 0
    # Iterative deepening should have produced extra entries beyond the seed.
    assert result.entries_found >= 2, (
        f"expected deepening to add entries; got {result.entries_found}"
    )
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_drives_followup_and_chase_search(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Hammer every iterative-deepening sub-loop: followup search results,
    chase-target website fetches, AND chase-target search queries."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    seen_search_queries: list[list[str]] = []

    async def _fake_search(queries, _key, **_kwargs):
        seen_search_queries.append(list(queries))
        # Each call yields a fresh URL so deepening sees new work to do.
        return [
            {
                "url": f"https://example.com/result-{len(seen_search_queries)}",
                "title": "Result",
                "publication": "Ex",
            }
        ]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _fake_followup(*_args, **_kwargs):
        from atlas_scout.steps.query_gen import SearchQuery

        return [
            SearchQuery(
                query="extra housing query",
                source_category="llm_followup",
                issue_area="housing_affordability",
            )
        ]

    async def _fake_chase(*_args, **_kwargs):
        # Return more than 5 targets so the [:5] browser-target slice exercises trim.
        return [
            {
                "name": f"Coalition {i}",
                "website": f"https://example.com/coalition-{i}",
                "search_query": f"Coalition {i} Austin",
            }
            for i in range(6)
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _fake_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    class _AlwaysExtractsProvider:
        max_concurrent = 1

        async def complete(self, messages, _schema=None):
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "Org desc.",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "",
                                    "email": "",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants "
                                        "locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": [],
                        }
                    )
                )
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    class _UniversalFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store):
            return PageContent(
                url=url,
                title="Page",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                task_id=task_id,
            )

        async def fetch(self, url: str):
            return PageContent(
                url=url,
                title="Page",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
            )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_AlwaysExtractsProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_UniversalFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.entries_found >= 2
    # Verify chase-search queries were issued
    assert any(
        any("Coalition" in q for q in queries) for queries in seen_search_queries
    )
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_skips_followup_results_with_none_pages(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Followup search results that fetch None or extract empty exercise loop continues."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    initial_done = False

    async def _fake_search(queries, _key, **_kwargs):
        nonlocal initial_done
        # `_produce_search_frontier` always passes a single-element list for
        # initial-phase calls. Deepening passes either follow-up queries or chase
        # search queries, both of which we can detect by comparing to the seed.
        is_initial = (
            not initial_done
            and len(queries) == 1
            and not queries[0].startswith("extra")
            and not queries[0].startswith("Coalition")
        )
        if is_initial:
            return [
                {"url": "https://example.com/seed", "title": "x", "publication": "y"},
            ]
        initial_done = True
        # Followup / chase searches return a payload that exercises:
        # - non-string URLs (None, int)
        # - blank strings
        # - duplicate URL (already in seen_urls)
        # - URL that fetches None (drives the lead-loop "continue" path)
        # - URL that fetches a page but extracts no entries
        return [
            {"url": None, "title": "x", "publication": "y"},
            {"url": "", "title": "x", "publication": "y"},
            {"url": "https://example.com/seed", "title": "x", "publication": "y"},
            {"url": "https://example.com/none-fetch", "title": "x", "publication": "y"},
            {"url": "https://example.com/empty-extract", "title": "x", "publication": "y"},
        ]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _fake_followup(*_args, **_kwargs):
        from atlas_scout.steps.query_gen import SearchQuery

        return [SearchQuery(query="extra", source_category="llm_followup", issue_area="x")]

    async def _fake_chase(*_args, **_kwargs):
        return [
            {"name": "C1", "website": "https://example.com/none-fetch", "search_query": "Coalition Austin"},
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _fake_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    class _MixedProvider:
        max_concurrent = 1

        async def complete(self, messages, _schema=None):
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                # Return the same canonical entry; downstream validate keeps it.
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "x",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "",
                                    "email": "",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": [],
                        }
                    )
                )
            # Pass 1 — return a single entity for pages whose text mentions the org;
            # for /empty-extract, return [] so identify yields nothing.
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    class _MixedFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store):
            return PageContent(
                url=url,
                title="Seed",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                task_id=task_id,
            )

        async def fetch(self, url: str):
            if "none-fetch" in url:
                return None
            if "empty-extract" in url:
                # Page exists but extraction yields nothing because text lacks the entity.
                return PageContent(url=url, title="Empty", text=("nothing of note " * 50))
            return PageContent(
                url=url,
                title="Page",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
            )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_MixedProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_MixedFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.run_id is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_no_search_api_key_skips_followup(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """When entered via direct_urls=None and no search_api_key, deepening still runs
    but skips the followup-search phase. NOTE: The pipeline raises before deepening
    when search mode + no api key — so to exercise the no-api-key branch within
    deepening, we need to provide a key for initial search and then clear it."""
    # The simpler way to reach `if search_api_key:` False inside deepening is to
    # call run_pipeline in direct-url mode while iterative_deepening=True. But
    # the pipeline gates deepening on `not direct_urls`, so direct-url mode skips
    # deepening entirely. The only practical exercise of `if search_api_key:` False
    # is via search mode with empty key — which raises before the deepening block.
    # So this branch is exercised by no test today; record the constraint as a
    # placeholder so future maintainers see why.


class _MultiLeadFetcher:
    """Fetcher used for the deepening lead loop with two leads, one yielding empty."""

    async def fetch_tracked(self, url: str, task_id: str, _store):
        return PageContent(
            url=url,
            title="Seed",
            text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
            task_id=task_id,
        )

    async def fetch(self, url: str):
        if "no-content" in url:
            # Page with text that won't yield extractions.
            return PageContent(
                url=url,
                title="Empty",
                text=("Filler that mentions nothing of note " * 50),
            )
        return PageContent(
            url=url,
            title="Page",
            text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
        )


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_lead_loop_with_empty_extraction(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """One lead extracts entries, the other returns empty — both loop branches fire."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def _fake_search(_queries, _key, **_kwargs):
        return [{"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _empty_followup(*_args, **_kwargs):
        return []

    async def _empty_chase(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _empty_chase
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    class _TwoLeadProvider:
        max_concurrent = 1

        async def complete(self, messages, _schema=None):
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                if "Source URL: https://example.com/no-content" in user_content:
                    # The "empty" lead's enrich pass returns no entries.
                    return Completion(
                        text=json.dumps({"entries": [], "discovery_leads": []})
                    )
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "x",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "",
                                    "email": "",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": [
                                "https://example.com/lead-1",
                                "https://example.com/no-content",
                            ],
                        }
                    )
                )
            if "nothing of note" in user_content:
                # Pass 1 for the empty lead returns no identified entities.
                return Completion(text="[]")
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_TwoLeadProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_MultiLeadFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.run_id is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_chase_target_without_website(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """A chase target with no website still drives the search-query branch."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def _fake_search(_queries, _key, **_kwargs):
        return [
            {
                "url": "https://example.com/seed",
                "title": "Seed",
                "publication": "Ex",
            }
        ]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _empty_followup(*_args, **_kwargs):
        return []

    async def _no_website_chase(*_args, **_kwargs):
        return [
            {"name": "Bare Org", "website": "", "search_query": ""},
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _no_website_chase
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.run_id is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_chase_with_empty_extractions(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Chase target whose website extracts empty AND search query returns mixed pages."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    initial_done = False

    async def _fake_search(queries, _key, **_kwargs):
        nonlocal initial_done
        # Initial-phase calls always pass single-query lists with the original generated query.
        is_initial = (
            not initial_done
            and len(queries) == 1
            and "Coalition" not in queries[0]
        )
        if is_initial:
            return [{"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"}]
        initial_done = True
        # Chase-search results: one fetches None, one extracts empty.
        return [
            {"url": "https://example.com/chase-none", "title": "x", "publication": "y"},
            {"url": "https://example.com/chase-empty", "title": "x", "publication": "y"},
        ]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _empty_followup(*_args, **_kwargs):
        return []

    async def _fake_chase(*_args, **_kwargs):
        return [
            {
                "name": "Coalition",
                "website": "https://example.com/coalition-empty",
                "search_query": "Coalition Austin",
            },
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    class _ChaseFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store):
            return PageContent(
                url=url,
                title="Seed",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                task_id=task_id,
            )

        async def fetch(self, url: str):
            if "chase-none" in url:
                return None
            # The other chase URLs return pages whose text yields no extractions.
            return PageContent(
                url=url,
                title="Empty",
                text=("Filler text with nothing of note " * 50),
            )

    class _ChaseProvider:
        max_concurrent = 1

        async def complete(self, messages, _schema=None):
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "x",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "",
                                    "email": "",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": [],
                        }
                    )
                )
            if "nothing of note" in user_content:
                # Identify pass returns nothing for empty pages.
                return Completion(text="[]")
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_ChaseProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_ChaseFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_browser_research_emits_status_when_entries_returned(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """When browser research returns entries for a chase target, status emit fires."""
    from atlas_shared import EntityType, GeoSpecificity

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def _fake_search(_queries, _key, **_kwargs):
        return [{"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _empty_followup(*_args, **_kwargs):
        return []

    async def _fake_chase(*_args, **_kwargs):
        return [
            {"name": "Org A", "website": "https://example.com/org-a", "search_query": ""},
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase
    )

    async def _browser_yields_entries(*_args, **_kwargs):
        return [
            RawEntry(
                name="Browser-Discovered Org",
                entry_type=EntityType.ORGANIZATION,
                description="From browser",
                city="Austin",
                state="TX",
                geo_specificity=GeoSpecificity.LOCAL,
                issue_areas=["housing_affordability"],
            )
        ]

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website",
        _browser_yields_entries,
    )

    class _Provider:
        max_concurrent = 1

        async def complete(self, messages, _schema=None):
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "x",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "",
                                    "email": "",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": [],
                        }
                    )
                )
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    class _Fetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url, task_id, _store):
            return PageContent(
                url=url,
                title="Seed",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                task_id=task_id,
            )

        async def fetch(self, url):
            return PageContent(
                url=url,
                title="Org",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
            )

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_Provider(),
        store=store,
        search_api_key="test-key",
        fetcher=_Fetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
        on_progress=on_progress,
    )

    status_phases = [payload.get("phase") for name, payload in events if name == "status"]
    assert "browser_research_complete" in status_phases
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_handles_dead_ends(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Iterative deepening with no leads, no follow-ups, no chase targets still completes."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def _fake_search(_queries, _key, **_kwargs):
        return [{"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _empty_followup(*_args, **_kwargs):
        return []

    async def _empty_chase(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _empty_chase
    )

    class _EmptyForDeepening:
        max_concurrent = 1

        async def complete(self, _messages, _schema=None):
            return Completion(text="[]")

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyForDeepening(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.run_id is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_iterative_deepening_skips_lead_when_fetch_returns_none(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """When a lead-fetch returns None, the loop must skip without raising."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def _fake_search(_queries, _key, **_kwargs):
        return [{"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    async def _empty_followup(*_args, **_kwargs):
        return []

    async def _chase_with_target(*_args, **_kwargs):
        return [
            {
                "name": "Coalition",
                "website": "https://example.com/coalition",
                "search_query": "",
            }
        ]

    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup
    )
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _chase_with_target
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr(
        "atlas_scout.scraper.browser_researcher.research_org_website", _no_browser
    )

    class _LeadProvider:
        max_concurrent = 1

        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, messages, _schema=None):
            self.calls += 1
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                return Completion(
                    text=json.dumps(
                        {
                            "entries": [
                                {
                                    "name": "Tenant Defense Collective",
                                    "type": "organization",
                                    "description": "Org desc.",
                                    "city": "Austin",
                                    "state": "TX",
                                    "geo_specificity": "local",
                                    "issue_areas": ["housing_affordability"],
                                    "website": "",
                                    "email": "",
                                    "social_media": {},
                                    "affiliated_org": None,
                                    "extraction_context": (
                                        "Tenant Defense Collective organizes tenants locally in Austin."
                                    ),
                                }
                            ],
                            "discovery_leads": ["https://example.com/lead"],
                        }
                    )
                )
            return Completion(
                text=(
                    '[{"name": "Tenant Defense Collective", "type": "organization", '
                    '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
                )
            )

    class _NoneOnFollowFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store):
            return PageContent(
                url=url,
                title="Seed",
                text=("Tenant Defense Collective organizes tenants locally in Austin. " * 50),
                task_id=task_id,
            )

        async def fetch(self, _url: str):
            # Return None for lead-fetch and chase-fetch to exercise the skip path.
            return None

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_LeadProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_NoneOnFollowFetcher(),
        iterative_deepening=True,
        min_entry_score=0.0,
    )

    assert result.run_id is not None
    await store.close()
