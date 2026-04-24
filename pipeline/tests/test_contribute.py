"""Tests for atlas_scout.steps.contribute."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest
import respx
from atlas_shared import (
    DeduplicatedEntry,
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoverySyncInfo,
    PageContent,
    RankedEntry,
    SourceType,
)

from atlas_scout.steps.contribute import contribute_entries, sync_run_artifacts


@pytest.mark.asyncio
@respx.mock
async def test_contribute_entries_posts_shared_batch_payload() -> None:
    """Scout should contribute one shared discovery batch to Atlas service."""
    route = respx.post("https://atlas.example/api/discovery-runs/contributions").mock(
        return_value=httpx.Response(
            201,
            json={
                "run_id": "run_123",
                "status": "completed",
                "entries_persisted": 1,
                "sources_persisted": 1,
            },
        )
    )

    result = await contribute_entries(
        [
            RankedEntry(
                entry=DeduplicatedEntry(
                    name="Prairie Workers Cooperative",
                    entry_type="organization",
                    description="Worker-owned cooperative in southwest Kansas.",
                    city="Garden City",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                    source_urls=["https://example.com/story"],
                    source_dates=[date(2026, 1, 15)],
                    source_contexts={
                        "https://example.com/story": "Prairie Workers Cooperative opened a new facility."
                    },
                    last_seen=date(2026, 1, 15),
                ),
                score=0.91,
            )
        ],
        atlas_url="https://atlas.example",
        api_key="key_123",
        location_query="Garden City, KS",
        state="KS",
        issue_areas=["worker_cooperatives"],
        sources=[
            PageContent(
                url="https://example.com/story",
                title="Prairie workers launch co-op",
                text="A worker-owned cooperative opened in Garden City.",
                source_type=SourceType.NEWS_ARTICLE,
            )
        ],
        stats=DiscoveryRunStats(
            queries_generated=4,
            sources_fetched=1,
            sources_processed=1,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
        ),
    )

    assert result.attempted == 1
    assert result.created == 1
    assert result.failed == 0
    assert route.called

    request = route.calls[0].request
    assert request.headers["X-API-Key"] == "key_123"
    payload = json.loads(request.content)
    assert payload["run"]["location_query"] == "Garden City, KS"
    assert payload["ranked_entries"][0]["entry"]["source_urls"] == ["https://example.com/story"]


@pytest.mark.asyncio
@respx.mock
async def test_sync_run_artifacts_posts_bundle_payload() -> None:
    """Scout should sync canonical run bundles to the Atlas sync API."""
    route = respx.post("https://atlas.example/api/discovery-runs/syncs").mock(
        return_value=httpx.Response(
            201,
            json={
                "run_id": "remote_123",
                "status": "completed",
                "sync_status": "synced",
                "entries_persisted": 1,
                "sources_persisted": 1,
                "duplicate": False,
            },
        )
    )

    result = await sync_run_artifacts(
        DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Garden City, KS",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id="local_123", sync_status="ready"),
            )
        ),
        atlas_url="https://atlas.example",
        api_key="key_123",
    )

    assert result.run_id == "remote_123"
    assert result.sync_status == "synced"
    assert route.called
