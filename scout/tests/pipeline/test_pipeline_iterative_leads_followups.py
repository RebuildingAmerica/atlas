"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion
from tests.pipeline.test_pipeline_branches_support import _SeedFetcher

if TYPE_CHECKING:
    from pathlib import Path


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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

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
        "atlas_scout.steps.browser_research.research_org_website",
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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

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

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

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

    monkeypatch.setattr("atlas_scout.steps.browser_research.research_org_website", _no_browser)

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
