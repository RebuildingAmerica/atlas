"""Tests for the scheduled discovery run trigger."""

from __future__ import annotations

import hashlib
import json
from http import HTTPStatus
from types import SimpleNamespace

import pytest

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery import run_creation
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD, DiscoveryScheduleCRUD
from atlas.platform.authz.dependency import LOCAL_MACHINE
from tests.domains.discovery.schedule_support import (
    EXPECTED_ACCEPTED,
    EXPECTED_TWO,
    INLINE_FORBIDDEN,
)
from tests.support.staff_auth import enable_staff_auth


@pytest.mark.asyncio
async def test_no_signed_in_account_can_start_the_nightly_sweep(
    test_client: object,
    test_settings: object,
) -> None:
    """Even the operator's own session cannot start it; only the scheduler's credential can."""
    headers = enable_staff_auth(test_settings)

    for account in (headers.ordinary, headers.staff):
        response = await test_client.post("/api/discovery-runs/scheduled", headers=account)

        assert response.status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.asyncio
async def test_the_scheduler_starts_the_nightly_sweep_with_its_credential(
    test_client: object,
    test_settings: object,
) -> None:
    enable_staff_auth(test_settings)
    key = "scheduler-test-key-" + "k" * 40  # pragma: allowlist secret
    test_settings.machine_trusted_issuers = json.dumps(
        [
            {
                "kind": "static_key",
                "name": "scheduler",
                "key_sha256": hashlib.sha256(key.encode()).hexdigest(),
                "actions": ["machine.runs.trigger_scheduled"],
            }
        ]
    )

    response = await test_client.post(
        "/api/discovery-runs/scheduled", headers={"Authorization": f"Bearer {key}"}
    )

    assert response.status_code == HTTPStatus.ACCEPTED


class TestScheduledRunEndpoint:
    @pytest.mark.asyncio
    async def test_execute_scheduled_runs_with_no_schedules(self, test_db: object) -> None:
        response = SimpleNamespace(status_code=None, headers={})
        resp = await discovery_api.execute_scheduled_runs(
            response=response,
            machine=LOCAL_MACHINE,
            db=test_db,
        )
        assert response.status_code == EXPECTED_ACCEPTED
        assert resp.enqueued == 0
        assert resp.results == []

    @pytest.mark.asyncio
    async def test_scheduled_enqueues_jobs_and_returns_202(self, test_db: object) -> None:
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

        response = SimpleNamespace(status_code=None, headers={})
        resp = await discovery_api.execute_scheduled_runs(
            response=response,
            machine=LOCAL_MACHINE,
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

        response = SimpleNamespace(status_code=None, headers={})
        resp = await discovery_api.execute_scheduled_runs(
            response=response,
            machine=LOCAL_MACHINE,
            db=test_db,
        )

        assert resp.enqueued == 1
        queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
        assert len(queued) == 1

    @pytest.mark.asyncio
    async def test_scheduled_is_idempotent_within_a_day(self, test_db: object) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )

        first = await discovery_api.execute_scheduled_runs(
            response=SimpleNamespace(status_code=None, headers={}),
            machine=LOCAL_MACHINE,
            db=test_db,
        )
        second = await discovery_api.execute_scheduled_runs(
            response=SimpleNamespace(status_code=None, headers={}),
            machine=LOCAL_MACHINE,
            db=test_db,
        )

        queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
        assert len(queued) == 1
        assert first.results[0].run_id == second.results[0].run_id
