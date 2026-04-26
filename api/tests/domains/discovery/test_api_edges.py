"""Edge-case coverage for discovery API routes and models."""

from __future__ import annotations

from http import HTTPStatus
from types import SimpleNamespace

import pytest
from atlas_shared import (
    DeduplicatedEntry,
    DiscoveryContributionRequest,
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunSyncRequest,
    DiscoverySyncInfo,
    PageContent,
    RankedEntry,
)

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models import EntryCRUD, SourceCRUD
from atlas.schemas import DiscoveryRunStartRequest

DB_BOOM_ERROR = "db boom"


def _fake_run(run_id: str, *, state: str = "MO") -> SimpleNamespace:
    return SimpleNamespace(
        id=run_id,
        location_query="Kansas City, MO",
        state=state,
        issue_areas=["housing_affordability"],
        queries_generated=0,
        sources_fetched=0,
        sources_processed=0,
        entries_extracted=0,
        entries_after_dedup=0,
        entries_confirmed=0,
        started_at="2026-01-01T00:00:00Z",
        completed_at=None,
        status="running",
        error_message=None,
        created_at="2026-01-01T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_start_discovery_run_surfaces_create_and_refresh_failures(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: object,
) -> None:
    """Discovery creation should fail loudly if the run cannot be reloaded."""
    test_settings.discovery_inline = False

    async def fake_create(_db: object, **_kwargs: object) -> str:
        return "run_500"

    async def missing_run(_db: object, _run_id: str) -> None:
        return None

    monkeypatch.setattr("atlas.domains.discovery.api.DiscoveryRunCRUD.create", fake_create)
    monkeypatch.setattr("atlas.domains.discovery.api.DiscoveryRunCRUD.get_by_id", missing_run)

    create_failure = await test_client.post(
        "/api/discovery-runs",
        json={
            "location_query": "Kansas City, MO",
            "state": "MO",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert create_failure.status_code == HTTPStatus.INTERNAL_SERVER_ERROR

    async def fake_get_by_id(_db: object, _run_id: str) -> object:
        return fake_get_by_id.results.pop(0)

    fake_get_by_id.results = [_fake_run("run_inline"), None]
    test_settings.discovery_inline = True
    monkeypatch.setattr("atlas.domains.discovery.api.DiscoveryRunCRUD.get_by_id", fake_get_by_id)

    async def fake_run_pipeline(**_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.discovery.api.run_discovery_pipeline_for_run",
        fake_run_pipeline,
    )

    refresh_failure = await test_client.post(
        "/api/discovery-runs",
        json={
            "location_query": "Kansas City, MO",
            "state": "MO",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert refresh_failure.status_code == HTTPStatus.INTERNAL_SERVER_ERROR


@pytest.mark.asyncio
async def test_discovery_route_functions_cover_direct_success_and_error_paths(
    monkeypatch: pytest.MonkeyPatch,
    test_db: object,
) -> None:
    """Direct route calls should cover response-less success and logged failures."""
    actor = AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )

    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
    )

    response = await discovery_api.get_discovery_run(
        run_id,
        actor=actor,
        response=None,
        db=test_db,
    )
    assert response.id == run_id

    collection = await discovery_api.list_discovery_runs(
        state="MO",
        status=None,
        limit=50,
        cursor=None,
        actor=actor,
        response=None,
        db=test_db,
    )
    assert collection.total >= 1
    assert any(item["id"] == run_id for item in collection.items)

    start_response = await discovery_api.start_discovery_run(
        DiscoveryRunStartRequest(
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        ),
        actor=actor,
        settings=SimpleNamespace(
            database_url="sqlite:///atlas.db",
            search_api_key=None,
            anthropic_api_key="test-key",
            discovery_inline=False,
        ),
        response=None,
        db=test_db,
    )
    assert start_response.id

    async def explode(*_args: object, **_kwargs: object) -> list[object]:
        raise RuntimeError(DB_BOOM_ERROR)

    monkeypatch.setattr(discovery_api.DiscoveryRunCRUD, "list", explode)

    with pytest.raises(RuntimeError, match=DB_BOOM_ERROR):
        await discovery_api.list_discovery_runs(
            state=None,
            status=None,
            limit=50,
            cursor=None,
            actor=actor,
            response=None,
            db=test_db,
        )


@pytest.mark.asyncio
async def test_discovery_run_count_supports_state_and_status_filters(test_db: object) -> None:
    """Discovery run counts should honor both state and status filters."""
    mo_run = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
    )
    ks_run = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Wichita, KS",
        state="KS",
        issue_areas=["housing_affordability"],
    )
    await DiscoveryRunCRUD.complete(test_db, mo_run, queries_generated=1)

    assert await DiscoveryRunCRUD.count(test_db, state="MO") == 1
    assert await DiscoveryRunCRUD.count(test_db, status="completed") == 1
    assert await DiscoveryRunCRUD.count(test_db, state="KS", status="running") == 1
    assert ks_run


@pytest.mark.asyncio
async def test_contribute_discovery_results_persists_shared_payload(test_db: object) -> None:
    """External runner payloads should create Atlas runs, entries, and sources."""
    actor = AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )

    result = await discovery_api.contribute_discovery_results(
        DiscoveryContributionRequest(
            run=DiscoveryRunInput(
                location_query="Garden City, KS",
                state="KS",
                issue_areas=["worker_cooperatives"],
            ),
            stats=DiscoveryRunStats(
                queries_generated=5,
                sources_fetched=1,
                sources_processed=1,
                entries_extracted=1,
                entries_after_dedup=1,
                entries_confirmed=1,
            ),
            sources=[],
            ranked_entries=[
                RankedEntry(
                    entry=DeduplicatedEntry(
                        name="Prairie Workers Cooperative",
                        entry_type="organization",
                        description="Worker-owned cooperative in southwest Kansas.",
                        city="Garden City",
                        state="KS",
                        issue_areas=["worker_cooperatives"],
                        source_urls=["https://example.com/story"],
                        source_contexts={
                            "https://example.com/story": (
                                "Prairie Workers Cooperative opened a new facility."
                            )
                        },
                    ),
                    score=0.88,
                )
            ],
        ),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert result.entries_persisted == 1
    assert result.sources_persisted == 1

    runs = await DiscoveryRunCRUD.list(test_db, state="KS")
    assert any(run.location_query == "Garden City, KS" for run in runs)

    entries = await EntryCRUD.list(test_db, state="KS", city="Garden City", active_only=False)
    assert any(entry.name == "Prairie Workers Cooperative" for entry in entries)

    source = await SourceCRUD.get_by_url(test_db, "https://example.com/story")
    assert source is not None


@pytest.mark.asyncio
async def test_sync_discovery_run_is_idempotent_for_same_local_bundle(test_db: object) -> None:
    """Replay of the same local run bundle should attach to the original Atlas run."""
    actor = AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )
    request = DiscoveryRunSyncRequest(
        artifacts=DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Garden City, KS",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id="local_123", sync_status="ready"),
            ),
            stats=DiscoveryRunStats(
                queries_generated=5,
                sources_fetched=1,
                sources_processed=1,
                entries_extracted=1,
                entries_after_dedup=1,
                entries_confirmed=1,
            ),
            sources=[
                PageContent(
                    url="https://example.com/story",
                    title="Prairie workers launch co-op",
                )
            ],
            ranked_entries=[
                RankedEntry(
                    entry=DeduplicatedEntry(
                        name="Prairie Workers Cooperative",
                        entry_type="organization",
                        description="Worker-owned cooperative in southwest Kansas.",
                        city="Garden City",
                        state="KS",
                        issue_areas=["worker_cooperatives"],
                        source_urls=["https://example.com/story"],
                        source_contexts={
                            "https://example.com/story": (
                                "Prairie Workers Cooperative opened a new facility."
                            )
                        },
                    ),
                    score=0.88,
                )
            ],
        )
    )

    first = await discovery_api.sync_discovery_run(
        request,
        response=None,
        actor=actor,
        db=test_db,
    )
    second = await discovery_api.sync_discovery_run(
        request,
        response=None,
        actor=actor,
        db=test_db,
    )

    assert first.duplicate is False
    assert second.duplicate is True
    assert second.run_id == first.run_id

    runs = await DiscoveryRunCRUD.list(test_db, state="KS")
    assert len([run for run in runs if run.location_query == "Garden City, KS"]) == 1
