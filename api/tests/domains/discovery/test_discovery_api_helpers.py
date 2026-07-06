"""Tests for discovery API helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunSyncRequest,
    DiscoverySyncInfo,
)
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models import EntryCRUD


@pytest.mark.parametrize(
    ("upload_target", "workspace_id", "actor_org_id", "expected"),
    [
        (None, None, "local", (None, None)),
        ("public", None, "local", ("public", None)),
        (
            "workspace",
            None,
            None,
            HTTPException(status_code=400, detail="Workspace upload target requires workspace id"),
        ),
        (
            "workspace",
            "org-1",
            None,
            HTTPException(status_code=403, detail="Workspace upload target requires org context"),
        ),
        (
            "workspace",
            "org-2",
            "org-1",
            HTTPException(status_code=403, detail="Workspace upload target does not match actor"),
        ),
        (
            "invalid",
            None,
            "local",
            HTTPException(status_code=400, detail="Invalid Scout upload target"),
        ),
    ],
)
def test_resolve_sync_destination_validates_targets(
    upload_target: str | None,
    workspace_id: str | None,
    actor_org_id: str | None,
    expected: tuple[str | None, str | None] | HTTPException,
) -> None:
    """Scout sync destinations should fail loudly on invalid or mismatched targets."""
    actor = SimpleNamespace(org_id=actor_org_id)
    if isinstance(expected, HTTPException):
        with pytest.raises(HTTPException) as exc_info:
            discovery_api._resolve_sync_destination(
                upload_target=upload_target,
                workspace_id=workspace_id,
                actor=actor,
            )
        assert exc_info.value.status_code == expected.status_code
        assert exc_info.value.detail == expected.detail
        return

    assert (
        discovery_api._resolve_sync_destination(
            upload_target=upload_target,
            workspace_id=workspace_id,
            actor=actor,
        )
        == expected
    )


@pytest.mark.parametrize(
    ("entry_type", "slug", "expected"),
    [
        ("person", "ada-lovelace", "/profiles/people/ada-lovelace"),
        ("organization", "atlas", "/profiles/organizations/atlas"),
        ("other", "atlas", None),
        ("person", None, None),
    ],
)
def test_entry_profile_path_maps_known_types(
    entry_type: str,
    slug: str | None,
    expected: str | None,
) -> None:
    """Only supported entry types should surface public profile paths."""
    assert discovery_api._entry_profile_path(entry_type=entry_type, slug=slug) == expected


@pytest.mark.parametrize(
    ("research_summary", "expected"),
    [
        ({"ranked_leads": "not-a-list"}, []),
        ({"ranked_leads": [{"entry_id": "entry-a"}, {"entry_id": ""}, "bad"]}, ["entry-a"]),
        (None, []),
    ],
)
def test_entry_ids_from_run_summary_skips_non_entry_rows(
    research_summary: object,
    expected: list[str],
) -> None:
    """Only well-formed ranked lead rows should become persisted entry ids."""
    run = SimpleNamespace(research_summary=research_summary)
    assert discovery_api._entry_ids_from_run_summary(run) == expected


@pytest.mark.asyncio
async def test_sync_entry_visibility_handles_public_and_workspace_paths(
    test_db: object,
) -> None:
    """Sync visibility should preserve public entries and private workspace receipts."""
    actor = SimpleNamespace(user_id="local-user")
    entry_id = "entry-1"

    with patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=True)):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id=entry_id,
                workspace_id=None,
                actor=actor,
            )
            == "public"
        )

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="local", visibility="private")),
        ),
    ):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id=entry_id,
                workspace_id="local",
                actor=actor,
            )
            == "workspace_private"
        )


@pytest.mark.asyncio
async def test_sync_entry_visibility_covers_existing_shared_and_review_paths(
    test_db: object,
) -> None:
    """Workspace syncs should distinguish shared and review-only receipts."""
    actor = SimpleNamespace(user_id="local-user")

    with patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=True)):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id="entry-1",
                workspace_id="local",
                actor=actor,
            )
            == "existing_shared"
        )

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="local", visibility="public")),
        ),
    ):
        assert (
            await discovery_api._sync_entry_visibility(
                test_db,
                entry_id="entry-2",
                workspace_id="local",
                actor=actor,
            )
            == "held_for_review"
        )


@pytest.mark.asyncio
async def test_sync_entry_visibility_rejects_foreign_private_receipts(
    test_db: object,
) -> None:
    """Private entries should not be silently reassigned to another workspace."""
    actor = SimpleNamespace(user_id="local-user")

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="other", visibility="private")),
        ),
        pytest.raises(HTTPException) as exc_info,
    ):
        await discovery_api._sync_entry_visibility(
            test_db,
            entry_id="entry-2",
            workspace_id="local",
            actor=actor,
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_sync_entry_visibility_creates_workspace_ownership_for_new_private_entries(
    test_db: object,
) -> None:
    """New private entries should be attached to the workspace explicitly."""
    actor = SimpleNamespace(user_id="local-user")
    create_mock = AsyncMock()

    with (
        patch.object(EntryCRUD, "is_publicly_visible", AsyncMock(return_value=False)),
        patch.object(OwnershipCRUD, "get_ownership", AsyncMock(return_value=None)),
        patch.object(OwnershipCRUD, "create_ownership", create_mock),
    ):
        result = await discovery_api._sync_entry_visibility(
            test_db,
            entry_id="entry-3",
            workspace_id="local",
            actor=actor,
        )

    assert result == "workspace_private"
    create_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_ensure_workspace_run_ownership_rejects_foreign_workspace(
    test_db: object,
) -> None:
    """A synced run should stay attached to its original workspace."""
    actor = SimpleNamespace(user_id="local-user")

    with (
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="other")),
        ),
        pytest.raises(HTTPException) as exc_info,
    ):
        await discovery_api._ensure_workspace_run_ownership(
            test_db,
            run_id="run-1",
            workspace_id="local",
            actor=actor,
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_ensure_workspace_run_ownership_returns_when_workspace_matches(
    test_db: object,
) -> None:
    """Already-owned runs should pass through without creating another receipt."""
    actor = SimpleNamespace(user_id="local-user")
    create_mock = AsyncMock()

    with (
        patch.object(
            OwnershipCRUD,
            "get_ownership",
            AsyncMock(return_value=SimpleNamespace(org_id="local")),
        ),
        patch.object(OwnershipCRUD, "create_ownership", create_mock),
    ):
        await discovery_api._ensure_workspace_run_ownership(
            test_db,
            run_id="run-1",
            workspace_id="local",
            actor=actor,
        )

    create_mock.assert_not_called()


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

    with patch.object(
        EntryCRUD,
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
    ):
        assert await discovery_api._entry_ids_from_artifacts(test_db, ranked_entries) == []


@pytest.mark.asyncio
async def test_sync_entry_links_skips_missing_entries(test_db: object) -> None:
    """Missing entries should be ignored when building sync links."""
    actor = SimpleNamespace(user_id="local-user")

    with patch.object(EntryCRUD, "get_by_id", AsyncMock(return_value=None)):
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
async def test_require_worker_job_rejects_missing_and_foreign_leases(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Worker leases should fail loudly when the job is missing or not owned."""

    job_result: object | None = None

    async def fake_get_by_id(_db: object, _job_id: str) -> object | None:
        return job_result

    monkeypatch.setattr(discovery_api.DiscoveryJobCRUD, "get_by_id", fake_get_by_id)

    with pytest.raises(HTTPException) as exc_info:
        await discovery_api._require_worker_job(
            test_db,
            job_id="missing",
            worker_id="worker-a",
        )
    assert exc_info.value.status_code == 404

    job_result = SimpleNamespace(
        status="completed",
        claimed_by="worker-a",
    )
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api._require_worker_job(
            test_db,
            job_id="completed",
            worker_id="worker-a",
        )
    assert exc_info.value.status_code == 409

    job_result = SimpleNamespace(
        status="claimed",
        claimed_by="worker-b",
    )
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api._require_worker_job(
            test_db,
            job_id="foreign",
            worker_id="worker-a",
        )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_worker_job_to_response_rejects_jobs_without_runs(
    test_db: object,
) -> None:
    """A leased job without a corresponding run should fail closed."""
    job = SimpleNamespace(
        id="job-1",
        run_id="run-1",
        status="claimed",
        execution_mode="manual",
        input_payload={},
        progress=0,
        error_message=None,
        retry_count=0,
        max_retries=3,
        created_at="2026-01-01T00:00:00Z",
        started_at=None,
        completed_at=None,
        claimed_by="worker-a",
        claimed_until=None,
        next_attempt_at=None,
    )

    with patch.object(DiscoveryRunCRUD, "get_by_id", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc_info:
            await discovery_api._worker_job_to_response(test_db, job)

    assert exc_info.value.status_code == 500


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
