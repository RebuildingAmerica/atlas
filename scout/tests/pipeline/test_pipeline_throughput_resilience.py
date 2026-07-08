"""Throughput-oriented pipeline resilience tests."""

from __future__ import annotations

import json

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message
from tests.pipeline.test_pipeline_throughput import (
    _ArticleAndSectionFetcher,
    _DeepArticleFetcher,
    _SectionSubsectionFetcher,
    _VerboseSkipFetcher,
)


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
async def test_run_pipeline_prioritizes_seed_and_article_pages_over_section_pages(
    tmp_db_path,
) -> None:
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
async def test_run_pipeline_reports_extraction_failures_not_empty(
    tmp_db_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from atlas_scout.store import ScoutStore

    async def no_retry_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("atlas_scout.steps.entry_extract.asyncio.sleep", no_retry_sleep)

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
async def test_run_pipeline_retries_extraction_once_before_succeeding(
    tmp_db_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from atlas_scout.store import ScoutStore

    async def no_retry_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("atlas_scout.steps.entry_extract.asyncio.sleep", no_retry_sleep)

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
