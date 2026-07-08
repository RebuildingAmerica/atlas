"""Tests for contribution sync bundle posting."""

from __future__ import annotations

import httpx
import pytest
import respx

from atlas_scout.steps.contribute import sync_run_artifacts

from .support import build_sync_artifacts


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
        build_sync_artifacts("local_123"),
        atlas_url="https://atlas.example",
        api_key="key_123",
    )

    assert result.run_id == "remote_123"
    assert result.sync_status == "synced"
    assert result.entry_links[0].name == "Prairie Workers Cooperative"
    assert result.entry_links[0].visibility == "held_for_review"
    assert route.called


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
        build_sync_artifacts("local_456"),
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
        build_sync_artifacts("local_500"),
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
        build_sync_artifacts("local_dns"),
        atlas_url="https://atlas.example",
        api_key="key",
    )

    assert result.created == 0
    assert any("dns down" in err for err in result.errors)
