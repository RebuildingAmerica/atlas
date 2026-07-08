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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

    # Entity-chase generators return dummy targets and follow-up queries.
    async def _fake_followup(*_args, **_kwargs):
        from atlas_scout.steps.query_gen import SearchQuery

        return [
            SearchQuery(
                query="extra housing query",
                source_category="llm_followup",
                issue_area="housing_affordability",
            ),
        ]

    async def _fake_chase(*_args, **_kwargs):
        return [
            {
                "name": "Outreach Coalition",
                "website": "https://example.com/coalition",
                "search_query": "Outreach Coalition Austin",
            }
        ]

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _fake_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase)

    # Avoid invoking the real Playwright browser path during entity chasing.
    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.steps.browser_research.research_org_website", _no_browser)

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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

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

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _fake_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase)

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.steps.browser_research.research_org_website", _no_browser)

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
    assert any(any("Coalition" in q for q in queries) for queries in seen_search_queries)
    await store.close()
