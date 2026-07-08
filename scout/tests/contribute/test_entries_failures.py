"""Tests for contribution entry failures."""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from atlas_scout.steps.contribute import contribute_entries

from .support import build_ranked_entry, build_stats


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
        [build_ranked_entry(name="Org", city="Austin", state="TX", score=0.95)],
        atlas_url="https://atlas.example/",
        api_key="",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=build_stats(),
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
        [build_ranked_entry(name="Org", city="Austin", state="TX", score=0.95)],
        atlas_url="https://atlas.example",
        api_key="key",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=build_stats(),
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
        [build_ranked_entry(name="Org", city="Austin", state="TX", score=0.95)],
        atlas_url="https://atlas.example",
        api_key="key",
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        sources=[],
        stats=build_stats(),
    )

    assert result.attempted == 1
    assert result.created == 0
    assert result.failed == 1
    assert any("connection refused" in err for err in result.errors)
