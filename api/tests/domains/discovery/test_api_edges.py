"""Edge-case coverage for discovery API routes and models."""

from __future__ import annotations

from http import HTTPStatus
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryRunCRUD
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
        BackgroundTasks(),
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
