"""Pipeline recovery from stored article corpus rows."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest

from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import _build_system_prompt, _prompt_key, _provider_cache_key

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_pipeline_recovers_entries_from_local_article_backlog(
    tmp_db_path: Path,
) -> None:
    """Location runs should turn existing article corpus rows into normal artifacts."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    await store.bulk_save_articles(
        [
            {
                "url": "https://news.example/2026/jane-doe-transit",
                "title": "Jane Doe pushes for better bus service",
                "published_at": "2026-07-01T10:00:00+00:00",
                "source_name": "Example News",
                "source_domain": "news.example",
                "section": "local",
                "provider": "crawl",
                "provider_id": "https://news.example/2026/jane-doe-transit",
                "api_url": None,
                "metadata": {
                    "discovery_method": "crawl",
                    "seed_url": "https://news.example/sitemap.xml",
                    "trail_text": "Jane Doe organized riders before the council vote.",
                    "body_text_excerpt": (
                        "Jane Doe organized riders before the council vote on bus service."
                    ),
                    "source_type": "news_article",
                    "publication": "Example News",
                },
            }
        ]
    )

    provider = AsyncMock()
    provider.max_concurrent = 1
    provider.complete.side_effect = [
        Completion(
            text=json.dumps(
                [
                    {
                        "name": "Jane Doe",
                        "type": "person",
                        "quote": (
                            "Jane Doe organized riders before the council vote on bus service."
                        ),
                    }
                ]
            ),
            parsed=None,
        ),
        Completion(
            text=json.dumps(
                {
                    "entries": [
                        {
                            "name": "Jane Doe",
                            "type": "person",
                            "description": "Transit organizer quoted in local coverage.",
                            "city": "Las Vegas",
                            "state": "NV",
                            "geo_specificity": "local",
                            "issue_areas": ["transportation"],
                            "website": None,
                            "email": None,
                            "social_media": {},
                            "affiliated_org": None,
                            "extraction_context": (
                                "Jane Doe organized riders before the council vote on bus service."
                            ),
                            "mentioned_entities": [],
                        }
                    ],
                    "discovery_leads": [],
                }
            ),
            parsed=None,
        ),
    ]

    result = await run_pipeline(
        location="Las Vegas, NV",
        issues=["transportation"],
        provider=provider,
        store=store,
        search_api_key="",
        target_count=1,
        min_entry_score=0.0,
    )

    assert result.entries_found == 1
    assert result.entries_after_dedup == 1
    assert result.artifacts is not None
    assert result.artifacts.sources[0].url == "https://news.example/2026/jane-doe-transit"
    assert result.artifacts.ranked_entries[0].entry.source_urls == [
        "https://news.example/2026/jane-doe-transit"
    ]

    saved_entries = await store.list_entries(run_id=result.run_id)
    assert len(saved_entries) == 1
    assert saved_entries[0]["entry_type"] == "person"
    assert saved_entries[0]["data"]["source_contexts"] == {
        "https://news.example/2026/jane-doe-transit": (
            "Jane Doe organized riders before the council vote on bus service."
        )
    }

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_target_count_bounds_article_backlog(
    tmp_db_path: Path,
) -> None:
    """A target count should stop a recovery run after enough confirmed entries."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    people = ["Alex Rivera", "Brianna Lee", "Carlos Martinez"]
    await store.bulk_save_articles(
        [
            {
                "url": f"https://news.example/2026/person-{index}",
                "title": f"{name} leads a neighborhood project",
                "published_at": f"2026-07-0{index}T10:00:00+00:00",
                "source_name": "Example News",
                "source_domain": "news.example",
                "section": "local",
                "provider": "crawl",
                "provider_id": f"https://news.example/2026/person-{index}",
                "api_url": None,
                "metadata": {
                    "discovery_method": "crawl",
                    "seed_url": "https://news.example/sitemap.xml",
                    "trail_text": f"{name} led a public meeting.",
                    "body_text_excerpt": f"{name} led a public meeting downtown.",
                    "source_type": "news_article",
                    "publication": "Example News",
                },
            }
            for index, name in enumerate(people, start=1)
        ]
    )

    class _CountingProvider:
        max_concurrent = 1

        def __init__(self) -> None:
            self.identify_calls = 0
            self.enrich_calls = 0

        async def complete(
            self,
            messages: list[Message],
            response_schema=None,
        ) -> Completion:
            content = messages[-1].content
            name = next(person for person in people if person in content)
            context = f"{name} led a public meeting downtown."
            if response_schema is None:
                self.identify_calls += 1
                return Completion(
                    text=json.dumps(
                        [
                            {
                                "name": name,
                                "type": "person",
                                "quote": context,
                            }
                        ]
                    )
                )

            self.enrich_calls += 1
            return Completion(
                text=json.dumps(
                    {
                        "entries": [
                            {
                                "name": name,
                                "type": "person",
                                "description": "Neighborhood civic lead.",
                                "city": "Las Vegas",
                                "state": "NV",
                                "geo_specificity": "local",
                                "issue_areas": ["transportation"],
                                "website": None,
                                "email": None,
                                "social_media": {},
                                "affiliated_org": None,
                                "extraction_context": context,
                                "mentioned_entities": [],
                            }
                        ],
                        "discovery_leads": [],
                    }
                )
            )

    provider = _CountingProvider()

    result = await run_pipeline(
        location="Las Vegas, NV",
        issues=["transportation"],
        provider=provider,
        store=store,
        search_api_key="",
        target_count=2,
        min_entry_score=0.0,
    )

    assert provider.identify_calls == 2
    assert provider.enrich_calls == 2
    assert result.entries_found == 2
    assert len(result.ranked_entries) == 2

    system_prompt = _build_system_prompt("Las Vegas", "NV", extraction_directive=None)
    next_claim = await store.claim_article_extraction_batch(
        owner_run_id="follow-up-run",
        provider_key=_provider_cache_key(provider),
        prompt_key=_prompt_key(system_prompt),
        limit=10,
    )
    assert [row["url"] for row in next_claim] == ["https://news.example/2026/person-1"]

    await store.close()
