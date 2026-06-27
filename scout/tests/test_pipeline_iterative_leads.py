"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from atlas_shared import PageContent, RawEntry

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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _empty_chase)

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.scraper.browser_researcher.research_org_website", _no_browser)

    class _TwoLeadProvider:
        max_concurrent = 1

        async def complete(self, messages, _schema=None):
            user_content = messages[1].content if len(messages) > 1 else ""
            if "IDENTIFIED ENTITIES" in user_content:
                if "Source URL: https://example.com/no-content" in user_content:
                    # The "empty" lead's enrich pass returns no entries.
                    return Completion(text=json.dumps({"entries": [], "discovery_leads": []}))
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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup)
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _no_website_chase
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.scraper.browser_researcher.research_org_website", _no_browser)

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
        is_initial = not initial_done and len(queries) == 1 and "Coalition" not in queries[0]
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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase)

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.scraper.browser_researcher.research_org_website", _no_browser)

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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase)

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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _empty_chase)

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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _empty_followup)
    monkeypatch.setattr(
        "atlas_scout.steps.entity_chase.select_entities_to_chase", _chase_with_target
    )

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.scraper.browser_researcher.research_org_website", _no_browser)

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
