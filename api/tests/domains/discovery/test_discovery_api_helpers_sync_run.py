"""Tests for discovery API helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunSyncRequest,
    DiscoverySyncInfo,
)

from atlas.domains.discovery import api as discovery_api


@pytest.mark.asyncio
async def test_entry_ids_from_artifacts_skips_unmatched_rows(test_db: object) -> None:
    """Only ranked entries with a durable database match should be returned."""
    ranked_entries = [
        SimpleNamespace(
            entry=SimpleNamespace(
                state="MO",
                city="Kansas City",
                entry_type="organization",
                name="Unmatched Org",
            )
        )
    ]

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            discovery_api.EntryCRUD,
            "list",
            AsyncMock(
                return_value=[
                    SimpleNamespace(
                        id="candidate-1",
                        type="organization",
                        name="Different Org",
                    )
                ]
            ),
        )
        assert await discovery_api._entry_ids_from_artifacts(test_db, ranked_entries) == []


@pytest.mark.asyncio
async def test_sync_entry_links_skips_missing_entries(test_db: object) -> None:
    """Missing entries should be ignored when building sync links."""
    actor = SimpleNamespace(user_id="local-user")

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(discovery_api.EntryCRUD, "get_by_id", AsyncMock(return_value=None))
        assert (
            await discovery_api._sync_entry_links(
                test_db,
                entry_ids=["missing-entry"],
                workspace_id="local",
                actor=actor,
            )
            == []
        )


@pytest.mark.asyncio
async def test_sync_discovery_run_falls_back_to_existing_run_summary(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Existing syncs should recover entry links from the durable run summary."""
    existing_sync = SimpleNamespace(remote_run_id="run-1")
    existing_run = SimpleNamespace(
        status="completed",
        entries_confirmed=0,
        sources_processed=0,
        research_summary={"ranked_leads": [{"entry_id": "entry-1"}]},
    )
    request = DiscoveryRunSyncRequest(
        artifacts=DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Kansas City, MO",
                    state="MO",
                    issue_areas=["housing_affordability"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id="local-1", sync_status="ready"),
            ),
            stats=DiscoveryRunStats(
                queries_generated=0,
                sources_fetched=0,
                sources_processed=0,
                entries_extracted=0,
                entries_after_dedup=0,
                entries_confirmed=0,
            ),
            sources=[],
            ranked_entries=[],
        )
    )

    monkeypatch.setattr(
        discovery_api.DiscoveryRunSyncCRUD,
        "get_by_identity",
        AsyncMock(return_value=existing_sync),
    )
    monkeypatch.setattr(
        discovery_api.DiscoveryRunCRUD,
        "get_by_id",
        AsyncMock(return_value=existing_run),
    )
    monkeypatch.setattr(discovery_api, "_sync_entry_links", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        discovery_api, "_ensure_workspace_run_ownership", AsyncMock(return_value=None)
    )

    response = await discovery_api.sync_discovery_run(
        request,
        response=SimpleNamespace(status_code=None, headers={}),
        actor=SimpleNamespace(user_id="local-user", org_id=None),
        db=test_db,
    )

    assert response.duplicate is True
    assert response.entry_links == []


@pytest.mark.asyncio
async def test_refresh_complete_and_fail_jobs_reject_missing_jobs(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Worker job endpoints should fail cleanly when the job vanished."""
    monkeypatch.setattr(discovery_api.DiscoveryJobCRUD, "get_by_id", AsyncMock(return_value=None))
    response = SimpleNamespace(status_code=None, headers={})

    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.heartbeat_discovery_job(
            job_id="job-1",
            req=discovery_api.DiscoveryWorkerHeartbeatRequest(worker_id="worker-1", progress={}),
            response=response,
            actor=SimpleNamespace(),
            db=test_db,
        )
    assert exc_info.value.status_code == 404

    monkeypatch.setattr(
        discovery_api, "_require_worker_job", AsyncMock(return_value=SimpleNamespace(id="job-1"))
    )
    monkeypatch.setattr(
        discovery_api.DiscoveryJobCRUD, "update_progress", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(discovery_api.DiscoveryJobCRUD, "get_by_id", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.heartbeat_discovery_job(
            job_id="job-1",
            req=discovery_api.DiscoveryWorkerHeartbeatRequest(worker_id="worker-1", progress={}),
            response=response,
            actor=SimpleNamespace(),
            db=test_db,
        )
    assert exc_info.value.status_code == 404

    monkeypatch.setattr(discovery_api.DiscoveryJobCRUD, "complete", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.complete_discovery_job(
            job_id="job-1",
            req=discovery_api.DiscoveryWorkerCompleteRequest(worker_id="worker-1"),
            response=response,
            actor=SimpleNamespace(),
            db=test_db,
        )
    assert exc_info.value.status_code == 404

    monkeypatch.setattr(discovery_api.DiscoveryJobCRUD, "fail", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.fail_discovery_job(
            job_id="job-1",
            req=discovery_api.DiscoveryWorkerFailRequest(
                worker_id="worker-1",
                error_message="boom",
                retryable=False,
            ),
            response=response,
            actor=SimpleNamespace(),
            db=test_db,
        )
    assert exc_info.value.status_code == 404
