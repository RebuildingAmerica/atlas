"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion

if TYPE_CHECKING:
    from pathlib import Path


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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

    async def _fake_followup(*_args, **_kwargs):
        from atlas_scout.steps.query_gen import SearchQuery

        return [SearchQuery(query="extra", source_category="llm_followup", issue_area="x")]

    async def _fake_chase(*_args, **_kwargs):
        return [
            {
                "name": "C1",
                "website": "https://example.com/none-fetch",
                "search_query": "Coalition Austin",
            },
        ]

    monkeypatch.setattr("atlas_scout.steps.entity_chase.generate_followup_queries", _fake_followup)
    monkeypatch.setattr("atlas_scout.steps.entity_chase.select_entities_to_chase", _fake_chase)

    async def _no_browser(*_args, **_kwargs) -> list[RawEntry]:
        return []

    monkeypatch.setattr("atlas_scout.steps.browser_research.research_org_website", _no_browser)

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
