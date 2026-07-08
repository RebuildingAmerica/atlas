"""Throughput-oriented pipeline behavior tests."""

from __future__ import annotations

import asyncio

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message
from tests.pipeline.test_pipeline_throughput import (
    _BlockingFetcher,
    _CrawlingFetcher,
    _OverlappingProvider,
    _ThinHubFetcher,
)


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
        timeout=5.0,
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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

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
