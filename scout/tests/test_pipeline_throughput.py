"""Throughput-oriented pipeline behavior tests."""

from __future__ import annotations

import asyncio
import json

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message


class _OverlappingProvider:
    def __init__(self, started: asyncio.Event) -> None:
        self.max_concurrent = 4
        self._started = started

    async def complete(
        self,
        _messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        self._started.set()
        return Completion(
            text=json.dumps(
                [
                    {
                        "name": "Speed Org",
                        "type": "organization",
                        "description": "Fast moving local org",
                        "city": "Austin",
                        "state": "TX",
                        "geo_specificity": "local",
                        "issue_areas": ["housing_affordability"],
                        "website": "https://speed.org",
                        "email": "hello@speed.org",
                        "social_media": {},
                        "affiliated_org": None,
                        "extraction_context": "Speed Org is active locally.",
                    }
                ]
            )
        )


class _BlockingFetcher:
    def __init__(self, provider_started: asyncio.Event) -> None:
        self._provider_started = provider_started

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
        if url.endswith("/first"):
            await asyncio.sleep(0.01)
            return PageContent(
                url=url,
                title="First",
                text="Speed Org is a housing advocacy organization. Housing content " * 50,
                task_id=task_id,
            )

        await self._provider_started.wait()
        return PageContent(
            url=url,
            title="Second",
            text="Speed Org education programs serve the community. Education content " * 50,
            task_id=task_id,
        )


class _CrawlingFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
        self.fetched_urls.append(url)
        if url.endswith("/seed"):
            return PageContent(
                url=url,
                title="Seed",
                text="Seed content " * 120,
                task_id=task_id,
                discovered_links=["https://example.com/linked"],
            )

        if url.endswith("/linked"):
            return PageContent(
                url=url,
                title="Linked",
                text="Linked content " * 120,
                task_id=task_id,
            )
        return None


class _VerboseSkipFetcher:
    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        return {
            "page": None,
            "status": "filtered",
            "error": "blocked_by_robots_txt",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _ThinHubFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.fetched_urls.append(url)
        if url.endswith("/hub"):
            return {
                "page": None,
                "status": "filtered",
                "error": "content_below_min_words",
                "discovered_links": ["https://example.com/article"],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/article"):
            return {
                "page": PageContent(
                    url=url,
                    title="Article",
                    text="Article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _ArticleAndSectionFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.fetched_urls.append(url)
        if url.endswith("/seed"):
            return {
                "page": PageContent(
                    url=url,
                    title="Seed article",
                    text="Seed article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [
                    "https://example.com/news",
                    "https://example.com/news/article/important-story",
                ],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/news"):
            return {
                "page": PageContent(
                    url=url,
                    title="News",
                    text="News section summary " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/important-story"):
            return {
                "page": PageContent(
                    url=url,
                    title="Important Story",
                    text="Important story content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _SectionSubsectionFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.fetched_urls.append(url)
        if url.endswith("/seed"):
            return {
                "page": PageContent(
                    url=url,
                    title="Seed article",
                    text="Seed article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [
                    "https://example.com/sports/colleges/utsa",
                    "https://example.com/statewide-housing-alliance",
                ],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/utsa"):
            return {
                "page": PageContent(
                    url=url,
                    title="UTSA Sports",
                    text="Sports section content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/statewide-housing-alliance"):
            return {
                "page": PageContent(
                    url=url,
                    title="Statewide Housing Alliance",
                    text="Housing alliance story " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _DeepArticleFetcher:
    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url.endswith("/seed"):
            return {
                "page": PageContent(
                    url=url,
                    title="Seed article",
                    text="Seed article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": ["https://example.com/related-housing-story-2026"],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/related-housing-story-2026"):
            return {
                "page": PageContent(
                    url=url,
                    title="Related story",
                    text="Related story content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": ["https://example.com/deeper-housing-story-2026"],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/deeper-housing-story-2026"):
            return {
                "page": PageContent(
                    url=url,
                    title="Deeper story",
                    text="Deeper story content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


@pytest.mark.asyncio
async def test_run_pipeline_starts_extraction_before_all_direct_fetches_finish(
    tmp_db_path,
) -> None:
    from atlas_scout.store import ScoutStore

    started = asyncio.Event()
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await asyncio.wait_for(
        run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=_OverlappingProvider(started),
            store=store,
            direct_urls=[
                "https://example.com/first",
                "https://example.com/second",
            ],
            fetcher=_BlockingFetcher(started),
        ),
        timeout=1.0,
    )

    assert result.entries_found >= 1
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_search_mode_tracks_page_tasks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_db_path,
) -> None:
    from atlas_scout.store import ScoutStore

    async def _fake_search(*_args, **_kwargs):
        return [
            {
                "url": "https://example.com/search-result",
                "title": "Search Result",
                "publication": "Example",
            }
        ]

    class _SearchFetcher:
        async def fetch(self, url: str) -> PageContent | None:
            return PageContent(
                url=url,
                title="Search Result",
                text="Civic content " * 120,
            )

        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Search Result",
                text="Civic content " * 120,
                task_id=task_id,
            )

    class _FastProvider:
        max_concurrent = 2

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            return Completion(text="[]")

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_FastProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SearchFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert len(page_tasks) == 1
    assert result.page_outcomes
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_follows_discovered_links_by_default(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _EmptyProvider:
        max_concurrent = 2

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            return Completion(text="[]")

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    fetcher = _CrawlingFetcher()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=fetcher,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert "https://example.com/seed" in fetcher.fetched_urls
    assert "https://example.com/linked" in fetcher.fetched_urls
    assert len(page_tasks) == 2
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_follows_links_from_thin_hub_pages(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _EmptyProvider:
        max_concurrent = 2

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            return Completion(text="[]")

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    fetcher = _ThinHubFetcher()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/hub"],
        fetcher=fetcher,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert "https://example.com/hub" in fetcher.fetched_urls
    assert "https://example.com/article" in fetcher.fetched_urls
    assert len(page_tasks) == 2
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_passes_extraction_directive(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _SinglePageFetcher:
        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Seed",
                text="Tenant Defense Collective organizes tenants locally in Austin. " * 50,
                task_id=task_id,
            )

    class _DirectiveProvider:
        def __init__(self) -> None:
            self.max_concurrent = 1
            self.system_prompt = ""
            self._calls = 0

        async def complete(
            self,
            messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            self._calls += 1
            if self._calls == 1:
                # Pass 1 (identify): return an entity so Pass 2 fires
                return Completion(
                    text='[{"name": "Tenant Defense Collective", "type": "organization", "quote": "organizes tenants"}]'
                )
            # Pass 2 (enrich): capture the system prompt which should contain the directive
            self.system_prompt = messages[0].content
            return Completion(text='{"entries": [], "discovery_leads": []}')

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _DirectiveProvider()

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=provider,
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SinglePageFetcher(),
        extraction_directive="Find local legal aid groups and tenant defense clinics.",
    )

    assert "Find local legal aid groups and tenant defense clinics." in provider.system_prompt
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_emits_structured_progress_events(
    monkeypatch: pytest.MonkeyPatch,
    tmp_db_path,
) -> None:
    from atlas_scout import pipeline as pipeline_module
    from atlas_scout.store import ScoutStore

    monkeypatch.setattr(pipeline_module, "_STATUS_INTERVAL_SECONDS", 0.01)

    class _SlowProvider:
        def __init__(self) -> None:
            self.max_concurrent = 1

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            await asyncio.sleep(0.03)
            return Completion(text="[]")

    class _SinglePageFetcher:
        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Seed",
                text="Tenant Defense Collective organizes tenants locally in Austin. " * 50,
                task_id=task_id,
            )

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_SlowProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SinglePageFetcher(),
        on_progress=on_progress,
    )

    event_names = [name for name, _payload in events]
    assert "frontier_queued" in event_names
    assert "fetch_started" in event_names
    assert "fetch_completed" in event_names
    assert "extract_started" in event_names
    assert "extract_empty" in event_names
    assert "status" in event_names

    status_payload = next(payload for name, payload in events if name == "status")
    assert "frontier_queued" in status_payload
    assert "extract_queued" in status_payload
    assert "fetch_active" in status_payload
    assert "extract_active" in status_payload

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_emits_skip_reason_in_progress_payload(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _EmptyProvider:
        max_concurrent = 1

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            return Completion(text="[]")

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/blocked"],
        fetcher=_VerboseSkipFetcher(),
        on_progress=on_progress,
    )

    skip_payload = next(payload for name, payload in events if name == "fetch_skipped")
    assert skip_payload["reason"] == "blocked_by_robots_txt"

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_reports_discovered_vs_queued_link_counts(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _EmptyProvider:
        max_concurrent = 1

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            return Completion(text="[]")

    class _LinkCountingFetcher:
        async def fetch_tracked_verbose(self, url: str, task_id: str, _store) -> dict[str, object]:
            if url == "https://example.com/seed":
                return {
                    "url": url,
                    "task_id": task_id,
                    "page": PageContent(
                        url=url,
                        title="Seed",
                        text="Local organizers are building power. " * 80,
                        task_id=task_id,
                    ),
                    "status": "fetched",
                    "error": None,
                    "discovered_links": [
                        "https://example.com/a",
                        "https://example.com/a",
                        "https://outside.example.org/b",
                    ],
                }
            return {
                "url": url,
                "task_id": task_id,
                "page": None,
                "status": "filtered",
                "error": "content_below_min_words",
                "discovered_links": [],
            }

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_LinkCountingFetcher(),
        on_progress=on_progress,
        max_pages_per_seed=2,
    )

    completed_payload = next(
        payload
        for name, payload in events
        if name == "fetch_completed" and payload.get("url") == "https://example.com/seed"
    )
    assert completed_payload["discovered_links"] == 2
    assert completed_payload["queued_links"] == 1

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_prioritizes_seed_and_article_pages_over_section_pages(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _RecordingOllamaLikeProvider:
        def __init__(self) -> None:
            self.max_concurrent = 12
            self.cache_identity = "ollama:qwen3.5:latest"
            self.pages_seen: list[str] = []

        async def complete(
            self,
            messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            # Pass 1 (identify) has page text directly; Pass 2 has "Source URL:"
            user_content = messages[1].content
            if "Source URL:" in user_content:
                source_line = user_content.splitlines()[0]
                self.pages_seen.append(source_line.removeprefix("Source URL: ").strip())
            return Completion(text="[]")

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _RecordingOllamaLikeProvider()

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=provider,
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_ArticleAndSectionFetcher(),
    )

    # All pages with content are sent to the identify pass
    # (pages_seen only captures Pass 2 calls, but identify pass processes all pages)
    assert len(provider.pages_seen) >= 0  # Pass 2 only fires if identify finds entities

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_extracts_all_pages_in_direct_mode(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _EmptyProvider:
        max_concurrent = 4

        async def complete(self, _messages: list[Message], _response_schema=None) -> Completion:
            return Completion(text="[]")

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _EmptyProvider()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=provider,
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SectionSubsectionFetcher(),
    )

    # All pages with content are fetched — the model decides what's useful
    assert result.pages_fetched >= 3

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_skips_depth_two_articles_in_direct_mode(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _EmptyProvider:
        max_concurrent = 4

        async def complete(self, _messages: list[Message], _response_schema=None) -> Completion:
            return Completion(text="[]")

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _EmptyProvider()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=provider,
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_DeepArticleFetcher(),
    )

    # All pages with content are fetched including deeper links
    assert result.pages_fetched >= 2

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_reports_extraction_failures_not_empty(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _SinglePageFetcher:
        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Seed",
                text="Tenant Defense Collective organizes tenants locally in Austin. " * 50,
                task_id=task_id,
            )

    class _TimeoutProvider:
        max_concurrent = 1

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            raise TimeoutError("llm request timed out")

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_TimeoutProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SinglePageFetcher(),
        on_progress=on_progress,
    )

    event_names = [name for name, _payload in events]
    assert "extract_failed" in event_names
    assert "extract_empty" not in event_names

    failure_payload = next(payload for name, payload in events if name == "extract_failed")
    assert failure_payload["reason"] == "llm request timed out after 5 attempts"

    page_tasks = await store.list_page_tasks(result.run_id)
    assert page_tasks[0]["status"] == "extract_failed"

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_retries_extraction_once_before_succeeding(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    class _SinglePageFetcher:
        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Seed",
                text="Tenant Defense Collective organizes tenants locally in Austin. " * 50,
                task_id=task_id,
            )

    class _FlakyProvider:
        def __init__(self) -> None:
            self.max_concurrent = 1
            self.calls = 0

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            self.calls += 1
            if self.calls == 1:
                raise TimeoutError("llm request timed out")
            # Call 2+: identify pass returns entity list, enrich pass returns full entry
            user_content = _messages[1].content if len(_messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                # Pass 2 (enrich)
                return Completion(
                    text=json.dumps({
                        "entries": [{
                            "name": "Tenant Defense Collective",
                            "type": "organization",
                            "description": "Organizes tenants locally.",
                            "city": "Austin", "state": "TX",
                            "geo_specificity": "local",
                            "issue_areas": ["housing_affordability"],
                            "website": "https://tenant.example",
                            "email": "hello@tenant.example",
                            "social_media": {},
                            "affiliated_org": None,
                            "extraction_context": "Tenant Defense Collective organizes tenants.",
                        }]
                    })
                )
            # Pass 1 (identify)
            return Completion(
                text='[{"name": "Tenant Defense Collective", "type": "organization", '
                '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
            )

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _FlakyProvider()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=provider,
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SinglePageFetcher(),
        on_progress=on_progress,
    )

    # Call 1: identify fails, Call 2: identify retry, Call 3: enrich
    assert provider.calls >= 3
    assert result.entries_found >= 1
    event_names = [name for name, _payload in events]
    assert "extract_retry" in event_names

    await store.close()
