"""Tests for Scout contribution entry posting."""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from atlas_scout.steps.contribute import contribute_entries

from .support import build_ranked_entry, build_source, build_stats


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
            build_ranked_entry(
                name="Prairie Workers Cooperative",
                city="Garden City",
                state="KS",
                score=0.91,
                source_url="https://example.com/story",
                source_context="Prairie Workers Cooperative opened a new facility.",
                issue_areas=["worker_cooperatives"],
            )
        ],
        atlas_url="https://atlas.example",
        api_key="key_123",
        location_query="Garden City, KS",
        state="KS",
        issue_areas=["worker_cooperatives"],
        sources=[build_source()],
        stats=build_stats(),
    )

    assert result.attempted == 1
    assert result.created == 1
    assert result.failed == 0
    assert route.called

    request = route.calls[0].request
    assert request.headers["X-API-Key"] == "key_123"
    payload = httpx.Response(200, content=request.content).json()
    assert payload["run"]["location_query"] == "Garden City, KS"
    assert payload["ranked_entries"][0]["entry"]["source_urls"] == ["https://example.com/story"]


@pytest.mark.asyncio
async def test_contribute_entries_returns_empty_when_no_eligible() -> None:
    """When no entries meet the score threshold the call short-circuits."""
    result = await contribute_entries(
        [build_ranked_entry(name="Low-score Org", city="Austin", state="TX", score=0.1)],
        atlas_url="https://atlas.example",
        api_key="key",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=build_stats(),
        min_score=0.7,
    )

    assert result.attempted == 0
    assert result.created == 0
    assert result.failed == 0
    assert result.errors == []
