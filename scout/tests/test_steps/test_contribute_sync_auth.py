"""Contribution sync auth header tests."""

from __future__ import annotations

import httpx
import pytest
import respx
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoverySyncInfo,
)

from atlas_scout.steps.contribute import sync_run_artifacts


def _artifacts() -> DiscoveryRunArtifacts:
    return DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Austin, TX",
                state="TX",
                issue_areas=["housing_affordability"],
            ),
            status="completed",
            sync=DiscoverySyncInfo(local_run_id="local_789", sync_status="ready"),
        )
    )


@pytest.mark.asyncio
@respx.mock
async def test_sync_sends_bearer_session_and_upload_target() -> None:
    """Logged-in Scout syncs carry a bearer credential and explicit destination."""
    route = respx.post("https://atlas.example/api/discovery-runs/syncs").mock(
        return_value=httpx.Response(
            201,
            json={
                "run_id": "remote_789",
                "status": "completed",
                "sync_status": "synced",
                "entries_persisted": 0,
                "sources_persisted": 0,
                "duplicate": False,
            },
        )
    )

    result = await sync_run_artifacts(
        _artifacts(),
        atlas_url="https://atlas.example/",
        api_key="",
        bearer_token="worker-token",
        target="workspace",
        workspace_id="org-123",
    )

    assert result.run_id == "remote_789"
    request = route.calls[0].request
    assert request.headers["Authorization"] == "Bearer worker-token"
    assert request.headers["X-Atlas-Upload-Target"] == "workspace"
    assert request.headers["X-Atlas-Workspace-Id"] == "org-123"
