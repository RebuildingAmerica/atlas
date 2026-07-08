"""Edge-case coverage for discovery API sync and scheduling paths."""
# ruff: noqa

from __future__ import annotations

from http import HTTPStatus
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from atlas_shared import DiscoveryContributionRequest, DiscoveryRunInput, DiscoveryRunStats

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD, DiscoveryScheduleCRUD

from tests.domains.discovery.api_edges_support import (
    DB_BOOM_ERROR,
    EXPECTED_TWO_RUNS,
    _bundle,
    _bundle_with_ranked_entry,
    _local_actor,
)


@pytest.mark.asyncio
async def test_sync_discovery_run_returns_entry_review_links_for_public_uploads(
    test_db: object,
) -> None:
    """Public syncs should tell Scout which entries landed in review instead of public search."""
    response = await discovery_api.sync_discovery_run(
        _bundle_with_ranked_entry(),
        response=None,
        actor=_local_actor(),
        db=test_db,
        x_atlas_upload_target="public",
    )

    assert response.entries_persisted == 1
    assert len(response.entry_links) == 1
    link = response.entry_links[0]
    assert link.name == "Prairie Workers Cooperative"
    assert link.type == "organization"
    assert link.visibility == "held_for_review"
    assert link.url is None


@pytest.mark.asyncio
async def test_workspace_sync_attaches_run_and_entries_to_private_workspace(
    test_db: object,
) -> None:
    """Workspace syncs should keep local worker output private to the user's workspace."""
    actor = AuthenticatedActor(
        user_id="workspace-user",
        email="workspace@example.org",
        auth_type="session",
        org_id="org-123",
    )

    response = await discovery_api.sync_discovery_run(
        _bundle_with_ranked_entry(local_run_id="workspace_local"),
        response=None,
        actor=actor,
        db=test_db,
        x_atlas_upload_target="workspace",
        x_atlas_workspace_id="org-123",
    )

    assert len(response.entry_links) == 1
    link = response.entry_links[0]
    assert link.visibility == "workspace_private"

    run_ownership = await OwnershipCRUD.get_ownership(test_db, response.run_id, "discovery_run")
    assert run_ownership is not None
    assert run_ownership.org_id == "org-123"
    assert run_ownership.visibility == "private"

    entry_ownership = await OwnershipCRUD.get_ownership(test_db, link.id, "entry")
    assert entry_ownership is not None
    assert entry_ownership.org_id == "org-123"
    assert entry_ownership.visibility == "private"


@pytest.mark.asyncio
async def test_contribute_discovery_results_marks_run_failed_when_persist_blows_up(
    monkeypatch: pytest.MonkeyPatch,
    test_db: object,
) -> None:
    """A persistence failure during contribution should mark the run failed and re-raise."""
    actor = _local_actor()

    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError(DB_BOOM_ERROR)

    monkeypatch.setattr(discovery_api, "persist_discovery_results", boom)

    with pytest.raises(RuntimeError, match=DB_BOOM_ERROR):
        await discovery_api.contribute_discovery_results(
            DiscoveryContributionRequest(
                run=DiscoveryRunInput(
                    location_query="Wichita, KS",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
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
            ),
            response=None,
            actor=actor,
            db=test_db,
        )

    runs = await DiscoveryRunCRUD.list(test_db, state="KS", status="failed")
    assert any(run.location_query == "Wichita, KS" for run in runs)


@pytest.mark.asyncio
async def test_sync_discovery_run_requires_local_run_id(test_db: object) -> None:
    """Missing sync info or empty local_run_id should 400."""
    actor = _local_actor()
    bundle = _bundle()
    bundle.artifacts.manifest.sync = None
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.sync_discovery_run(
            bundle,
            response=None,
            actor=actor,
            db=test_db,
        )
    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST


@pytest.mark.asyncio
async def test_sync_discovery_run_500_when_existing_run_missing(
    monkeypatch: pytest.MonkeyPatch,
    test_db: object,
) -> None:
    """Idempotent re-sync should 500 when the original Atlas run can't be reloaded."""
    actor = _local_actor()
    bundle = _bundle(local_run_id="local_existing")

    await discovery_api.sync_discovery_run(
        bundle,
        response=None,
        actor=actor,
        db=test_db,
    )

    real_get = DiscoveryRunCRUD.get_by_id

    async def fake_get(db: object, run_id: str) -> object:
        if run_id and not run_id.startswith("missing"):
            existing = await real_get(db, run_id)
            if existing is not None:
                return None
        return await real_get(db, run_id)

    monkeypatch.setattr(discovery_api.DiscoveryRunCRUD, "get_by_id", fake_get)

    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.sync_discovery_run(
            bundle,
            response=None,
            actor=actor,
            db=test_db,
        )
    assert exc_info.value.status_code == HTTPStatus.INTERNAL_SERVER_ERROR


@pytest.mark.asyncio
async def test_sync_discovery_run_rejects_unknown_remote_run_id(test_db: object) -> None:
    """Explicit remote_run_id that doesn't exist should 400."""
    actor = _local_actor()
    bundle = _bundle(remote_run_id="run_does_not_exist")
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.sync_discovery_run(
            bundle,
            response=None,
            actor=actor,
            db=test_db,
        )
    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST


@pytest.mark.asyncio
async def test_sync_discovery_run_attaches_to_existing_remote_run(test_db: object) -> None:
    """A valid remote_run_id should attach the bundle to the pre-created run."""
    actor = _local_actor()

    pre_existing = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Wichita, KS",
        state="KS",
        issue_areas=["worker_cooperatives"],
    )
    bundle = _bundle(local_run_id="local_attach", remote_run_id=pre_existing)

    response = await discovery_api.sync_discovery_run(
        bundle,
        response=None,
        actor=actor,
        db=test_db,
    )
    assert response.run_id == pre_existing
    assert response.duplicate is False


@pytest.mark.asyncio
async def test_sync_discovery_run_marks_run_failed_when_persist_blows_up(
    monkeypatch: pytest.MonkeyPatch,
    test_db: object,
) -> None:
    """Sync persist-artifact failure should fail the remote run and re-raise."""
    actor = _local_actor()

    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError(DB_BOOM_ERROR)

    monkeypatch.setattr(discovery_api, "persist_discovery_artifacts", boom)

    with pytest.raises(RuntimeError, match=DB_BOOM_ERROR):
        await discovery_api.sync_discovery_run(
            _bundle(local_run_id="local_boom"),
            response=None,
            actor=actor,
            db=test_db,
        )

    runs = await DiscoveryRunCRUD.list(test_db, state="KS", status="failed")
    assert any(run.location_query == "Wichita, KS" for run in runs)


@pytest.mark.asyncio
async def test_execute_scheduled_runs_no_schedules_returns_empty(test_db: object) -> None:
    """No enabled schedules should short-circuit with enqueued=0."""
    actor = _local_actor()
    http_response = SimpleNamespace(status_code=None, headers={})
    response = await discovery_api.execute_scheduled_runs(
        response=http_response,
        actor=actor,
        settings=SimpleNamespace(
            database_url="sqlite:///atlas.db",
            search_api_key=None,
            anthropic_api_key="test-key",
        ),
        db=test_db,
    )
    assert http_response.status_code == HTTPStatus.ACCEPTED
    assert response.enqueued == 0
    assert response.results == []


@pytest.mark.asyncio
async def test_execute_scheduled_runs_enqueues_a_job_per_schedule(
    test_db: object,
) -> None:
    """Each enabled schedule should enqueue exactly one durable queued job."""
    actor = _local_actor()

    first_id = await DiscoveryScheduleCRUD.create(
        test_db,
        location_query="Topeka, KS",
        state="KS",
        issue_areas=["worker_cooperatives"],
    )
    second_id = await DiscoveryScheduleCRUD.create(
        test_db,
        location_query="Lawrence, KS",
        state="KS",
        issue_areas=["worker_cooperatives"],
    )

    http_response = SimpleNamespace(status_code=None, headers={})
    response = await discovery_api.execute_scheduled_runs(
        response=http_response,
        actor=actor,
        settings=SimpleNamespace(
            database_url="sqlite:///atlas.db",
            search_api_key=None,
            anthropic_api_key="test-key",
        ),
        db=test_db,
    )

    assert response.enqueued == EXPECTED_TWO_RUNS
    queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
    assert len(queued) == EXPECTED_TWO_RUNS
    schedule_ids = {result.schedule_id for result in response.results}
    assert schedule_ids == {first_id, second_id}
    for result in response.results:
        assert result.job_id
