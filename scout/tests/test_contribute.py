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
                "entry_links": [
                    {
                        "id": "entry_123",
                        "name": "Prairie Workers Cooperative",
                        "type": "organization",
                        "slug": None,
                        "visibility": "held_for_review",
                        "url": None,
                    }
                ],
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
    assert result.entry_links[0].name == "Prairie Workers Cooperative"
    assert result.entry_links[0].visibility == "held_for_review"
    assert route.called


@pytest.mark.asyncio
async def test_contribute_entries_returns_empty_when_no_eligible() -> None:
    """When no entries meet the score threshold the call short-circuits."""
    result = await contribute_entries(
        [
            RankedEntry(
                entry=DeduplicatedEntry(
                    name="Low-score Org",
                    entry_type="organization",
                    description="below threshold",
                    city="Austin",
                    state="TX",
                    issue_areas=["housing_affordability"],
                    source_urls=["https://example.com"],
                    source_dates=[date(2026, 1, 15)],
                    source_contexts={"https://example.com": "context"},
                    last_seen=date(2026, 1, 15),
                ),
                score=0.1,
            )
        ],
        atlas_url="https://atlas.example",
        api_key="key",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=DiscoveryRunStats(
            queries_generated=0,
            sources_fetched=0,
            sources_processed=0,
            entries_extracted=0,
            entries_after_dedup=0,
            entries_confirmed=0,
        ),
        min_score=0.7,
    )

    assert result.attempted == 0
    assert result.created == 0
    assert result.failed == 0
    assert result.errors == []


@pytest.mark.asyncio
@respx.mock
async def test_contribute_entries_omits_api_key_header_when_empty() -> None:
    """An empty api_key disables the X-API-Key header."""
    route = respx.post("https://atlas.example/api/discovery-runs/contributions").mock(
        return_value=httpx.Response(
            201,
            json={
                "run_id": "run_123",
                "status": "completed",
                "entries_persisted": 1,
                "sources_persisted": 0,
            },
        )
    )

    result = await contribute_entries(
        [
            RankedEntry(
                entry=DeduplicatedEntry(
                    name="Org",
                    entry_type="organization",
                    description="d",
                    city="Austin",
                    state="TX",
                    issue_areas=["housing_affordability"],
                    source_urls=["https://example.com"],
                    source_dates=[date(2026, 1, 1)],
                    source_contexts={"https://example.com": "ctx"},
                    last_seen=date(2026, 1, 1),
                ),
                score=0.95,
            )
        ],
        atlas_url="https://atlas.example/",  # trailing slash is stripped
        api_key="",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=1,
            sources_processed=1,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
        ),
    )

    assert result.created == 1
    assert "X-API-Key" not in route.calls[0].request.headers


@pytest.mark.asyncio
@respx.mock
async def test_contribute_entries_returns_failure_on_http_status_error() -> None:
    """An HTTP 500 response is logged and returned as failed."""
    respx.post("https://atlas.example/api/discovery-runs/contributions").mock(
        return_value=httpx.Response(500, json={"detail": "boom"})
    )

    result = await contribute_entries(
        [
            RankedEntry(
                entry=DeduplicatedEntry(
                    name="Org",
                    entry_type="organization",
                    description="d",
                    city="Austin",
                    state="TX",
                    issue_areas=["housing_affordability"],
                    source_urls=["https://example.com"],
                    source_dates=[date(2026, 1, 1)],
                    source_contexts={"https://example.com": "ctx"},
                    last_seen=date(2026, 1, 1),
                ),
                score=0.95,
            )
        ],
        atlas_url="https://atlas.example",
        api_key="key",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=1,
            sources_processed=1,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
        ),
    )

    assert result.attempted == 1
    assert result.created == 0
    assert result.failed == 1
    assert any("HTTP 500" in err for err in result.errors)


@pytest.mark.asyncio
@respx.mock
async def test_contribute_entries_returns_failure_on_request_error() -> None:
    """A network-level request error is captured and returned as failed."""
    respx.post("https://atlas.example/api/discovery-runs/contributions").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    result = await contribute_entries(
        [
            RankedEntry(
                entry=DeduplicatedEntry(
                    name="Org",
                    entry_type="organization",
                    description="d",
                    city="Austin",
                    state="TX",
                    issue_areas=["housing_affordability"],
                    source_urls=["https://example.com"],
                    source_dates=[date(2026, 1, 1)],
                    source_contexts={"https://example.com": "ctx"},
                    last_seen=date(2026, 1, 1),
                ),
                score=0.95,
            )
        ],
        atlas_url="https://atlas.example",
        api_key="key",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=1,
            sources_processed=1,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
        ),
    )

    assert result.attempted == 1
    assert result.created == 0
    assert result.failed == 1
    assert any("connection refused" in err for err in result.errors)


@pytest.mark.asyncio
@respx.mock
async def test_sync_run_artifacts_omits_api_key_header_when_empty() -> None:
    """sync_run_artifacts omits the X-API-Key header when api_key is empty."""
    route = respx.post("https://atlas.example/api/discovery-runs/syncs").mock(
        return_value=httpx.Response(
            201,
            json={
                "run_id": "remote_456",
                "status": "completed",
                "sync_status": "synced",
                "entries_persisted": 0,
                "sources_persisted": 0,
                "duplicate": True,
            },
        )
    )

    result = await sync_run_artifacts(
        DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Austin, TX",
                    state="TX",
                    issue_areas=["housing_affordability"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id="local_456", sync_status="ready"),
            )
        ),
        atlas_url="https://atlas.example/",
        api_key="",
    )

    assert result.duplicate is True
    assert result.failed == 0
    assert "X-API-Key" not in route.calls[0].request.headers


@pytest.mark.asyncio
@respx.mock
async def test_sync_run_artifacts_returns_failure_on_http_status_error() -> None:
    """A 500 response from the sync endpoint is reported as failed."""
    respx.post("https://atlas.example/api/discovery-runs/syncs").mock(
        return_value=httpx.Response(500, json={"detail": "fail"})
    )

    result = await sync_run_artifacts(
        DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Austin, TX",
                    state="TX",
                    issue_areas=["housing_affordability"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id="local_500", sync_status="ready"),
            )
        ),
        atlas_url="https://atlas.example",
        api_key="key",
    )

    assert result.created == 0
    assert any("HTTP 500" in err for err in result.errors)


@pytest.mark.asyncio
@respx.mock
async def test_sync_run_artifacts_returns_failure_on_request_error() -> None:
    """A request-level error during sync is reported as failed."""
    respx.post("https://atlas.example/api/discovery-runs/syncs").mock(
        side_effect=httpx.ConnectError("dns down")
    )

    result = await sync_run_artifacts(
        DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Austin, TX",
                    state="TX",
                    issue_areas=["housing_affordability"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id="local_dns", sync_status="ready"),
            )
        ),
        atlas_url="https://atlas.example",
        api_key="key",
    )

    assert result.created == 0
    assert any("dns down" in err for err in result.errors)
