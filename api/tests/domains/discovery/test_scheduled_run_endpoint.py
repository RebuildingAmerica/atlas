"""Tests for the scheduled discovery run trigger."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery import run_creation
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD, DiscoveryScheduleCRUD
from tests.domains.discovery.schedule_support import (
    EXPECTED_ACCEPTED,
    EXPECTED_TWO,
    INLINE_FORBIDDEN,
)


class TestScheduledRunEndpoint:
    @pytest.mark.asyncio
    async def test_execute_scheduled_runs_with_no_schedules(self, test_db: object, actor) -> None:
        settings = SimpleNamespace(
            database_url="sqlite:///test.db",
            search_api_key=None,
            anthropic_api_key="test-key",
        )
        response = SimpleNamespace(status_code=None, headers={})
        resp = await discovery_api.execute_scheduled_runs(
            response=response,
            actor=actor,
            settings=settings,
            db=test_db,
        )
        assert response.status_code == EXPECTED_ACCEPTED
        assert resp.enqueued == 0
        assert resp.results == []

    @pytest.mark.asyncio
    async def test_scheduled_enqueues_jobs_and_returns_202(self, test_db: object, actor) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["worker_cooperatives"],
        )

        settings = SimpleNamespace(
            database_url="sqlite:///test.db",
            search_api_key=None,
            anthropic_api_key="test-key",
        )
        response = SimpleNamespace(status_code=None, headers={})
        resp = await discovery_api.execute_scheduled_runs(
            response=response,
            actor=actor,
            settings=settings,
            db=test_db,
        )

        assert response.status_code == EXPECTED_ACCEPTED
        assert resp.enqueued == EXPECTED_TWO
        assert len(resp.results) == EXPECTED_TWO

        queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
        assert len(queued) == EXPECTED_TWO

        run_ids = {result.run_id for result in resp.results}
        assert len(run_ids) == EXPECTED_TWO
        for result in resp.results:
            run = await DiscoveryRunCRUD.get_by_id(test_db, result.run_id)
            assert run is not None
            schedule = await DiscoveryScheduleCRUD.get_by_id(test_db, result.schedule_id)
            assert schedule is not None
            assert schedule.last_run_id == result.run_id
            assert schedule.last_run_at is not None

    @pytest.mark.asyncio
    async def test_scheduled_does_not_run_pipeline_inline(
        self,
        test_db: object,
        actor,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )

        async def _explode(*, database_url: object, job: object, credentials: object) -> None:
            _ = database_url, job, credentials
            raise AssertionError(INLINE_FORBIDDEN)

        monkeypatch.setattr(run_creation, "run_discovery_pipeline_for_run", _explode)

        settings = SimpleNamespace(
            database_url="sqlite:///test.db",
            search_api_key=None,
            anthropic_api_key="test-key",
        )
        response = SimpleNamespace(status_code=None, headers={})
        resp = await discovery_api.execute_scheduled_runs(
            response=response,
            actor=actor,
            settings=settings,
            db=test_db,
        )

        assert resp.enqueued == 1
        queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
        assert len(queued) == 1

    @pytest.mark.asyncio
    async def test_scheduled_is_idempotent_within_a_day(self, test_db: object, actor) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )

        settings = SimpleNamespace(
            database_url="sqlite:///test.db",
            search_api_key=None,
            anthropic_api_key="test-key",
        )
        first = await discovery_api.execute_scheduled_runs(
            response=SimpleNamespace(status_code=None, headers={}),
            actor=actor,
            settings=settings,
            db=test_db,
        )
        second = await discovery_api.execute_scheduled_runs(
            response=SimpleNamespace(status_code=None, headers={}),
            actor=actor,
            settings=settings,
            db=test_db,
        )

        queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
        assert len(queued) == 1
        assert first.results[0].run_id == second.results[0].run_id
