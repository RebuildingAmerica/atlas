"""Tests for discovery schedule management and trigger endpoints."""

from __future__ import annotations

import tempfile
from types import SimpleNamespace

import pytest
import pytest_asyncio

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery import api_schedule
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryScheduleCRUD,
)
from atlas.domains.discovery.schemas import (
    DiscoveryScheduleCreateRequest,
    DiscoveryScheduleUpdateRequest,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection, init_db

EXPECTED_NOT_FOUND = 404
EXPECTED_BAD_REQUEST = 400


@pytest_asyncio.fixture
async def test_db() -> object:
    """Create a temporary test database with schema."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        url = f"sqlite:///{f.name}"
    await init_db(url)
    conn = await get_db_connection(url)
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
def actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="test-user",
        email="test@example.com",
        auth_type="local",
        permissions={"discovery": ["read", "write"]},
    )


class TestScheduleEndpoints:
    @pytest.mark.asyncio
    async def test_create_schedule(self, test_db: object, actor: AuthenticatedActor) -> None:
        req = DiscoveryScheduleCreateRequest(
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.create_schedule(
            req,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.id
        assert resp.location_query == "Austin, TX"
        assert resp.enabled is True

    @pytest.mark.asyncio
    async def test_list_schedules(self, test_db: object, actor: AuthenticatedActor) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.list_schedules(
            response=None,
            enabled_only=False,
            limit=100,
            actor=actor,
            db=test_db,
        )
        assert resp.total == 1
        assert len(resp.items) == 1

    @pytest.mark.asyncio
    async def test_get_schedule(self, test_db: object, actor: AuthenticatedActor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.get_schedule(
            sid,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.id == sid

    @pytest.mark.asyncio
    async def test_get_schedule_not_found(self, test_db: object, actor: AuthenticatedActor) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.get_schedule(
                "nonexistent",
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_schedule(self, test_db: object, actor: AuthenticatedActor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        req = DiscoveryScheduleUpdateRequest(enabled=False)
        resp = await api_schedule.update_schedule(
            sid,
            req,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.enabled is False

    @pytest.mark.asyncio
    async def test_delete_schedule(self, test_db: object, actor: AuthenticatedActor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await api_schedule.delete_schedule(sid, actor=actor, db=test_db)
        assert await DiscoveryScheduleCRUD.get_by_id(test_db, sid) is None

    @pytest.mark.asyncio
    async def test_delete_schedule_not_found(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.delete_schedule("nonexistent", actor=actor, db=test_db)
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_create_schedule_invalid_issue_area(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        from fastapi import HTTPException

        req = DiscoveryScheduleCreateRequest(
            location_query="Austin, TX",
            state="TX",
            issue_areas=["totally_fake_issue"],
        )
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.create_schedule(
                req,
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_update_schedule_not_found(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.update_schedule(
                "nonexistent",
                DiscoveryScheduleUpdateRequest(enabled=False),
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_schedule_invalid_issue_area(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        from fastapi import HTTPException

        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.update_schedule(
                sid,
                DiscoveryScheduleUpdateRequest(issue_areas=["totally_fake_issue"]),
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_update_schedule_with_empty_payload_returns_unchanged(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.update_schedule(
            sid,
            DiscoveryScheduleUpdateRequest(),
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.id == sid


@pytest.mark.asyncio
async def test_get_db_dependency_yields_and_closes_connection(tmp_db_path: str) -> None:
    """The get_db FastAPI dependency yields a connection and tears it down on exit."""
    from atlas.platform.config import Settings

    settings = Settings(database_url=f"sqlite:///{tmp_db_path}", deploy_mode="local")
    await init_db(settings.database_url)

    agen = api_schedule.get_db(settings=settings)
    conn = await agen.__anext__()
    cursor = await conn.execute("SELECT 1")
    row = await cursor.fetchone()
    assert row[0] == 1
    with pytest.raises(StopAsyncIteration):
        await agen.__anext__()


EXPECTED_ACCEPTED = 202
EXPECTED_TWO = 2
_INLINE_FORBIDDEN = "pipeline must not run inline for scheduled triggers"


class TestScheduledRunEndpoint:
    @pytest.mark.asyncio
    async def test_execute_scheduled_runs_with_no_schedules(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
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
    async def test_scheduled_enqueues_jobs_and_returns_202(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
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
        actor: AuthenticatedActor,
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
            raise AssertionError(_INLINE_FORBIDDEN)

        monkeypatch.setattr(discovery_api, "run_discovery_pipeline_for_run", _explode)

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
    async def test_scheduled_is_idempotent_within_a_day(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
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


class TestJobStatusEndpoint:
    @pytest.mark.asyncio
    async def test_get_job(self, test_db: object, actor: AuthenticatedActor) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.get_discovery_job(
            job_id,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.id == job_id
        assert resp.status == "queued"

    @pytest.mark.asyncio
    async def test_get_job_not_found(self, test_db: object, actor: AuthenticatedActor) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await discovery_api.get_discovery_job(
                "nonexistent",
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND


class TestCancelRunEndpoint:
    @pytest.mark.asyncio
    async def test_cancel_run_cancels_jobs(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.cancel_discovery_run(
            run_id,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.run_id == run_id
        assert resp.jobs_cancelled == 1
        job = await DiscoveryJobCRUD.get_by_run_id(test_db, run_id)
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_run_not_found(self, test_db: object, actor: AuthenticatedActor) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await discovery_api.cancel_discovery_run(
                "nonexistent",
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_cancel_run_with_no_active_jobs_returns_zero(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await DiscoveryJobCRUD.complete(test_db, job_id)

        resp = await discovery_api.cancel_discovery_run(
            run_id,
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.jobs_cancelled == 0


class TestPipelineSummaryEndpoint:
    @pytest.mark.asyncio
    async def test_summary_empty(self, test_db: object, actor: AuthenticatedActor) -> None:
        resp = await discovery_api.get_pipeline_summary(
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.queued_jobs == 0
        assert resp.running_jobs == 0
        assert resp.failed_jobs == 0
        assert resp.completed_runs_total == 0
        assert resp.enabled_schedules == 0

    @pytest.mark.asyncio
    async def test_summary_counts_schedules_and_jobs(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.get_pipeline_summary(
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.queued_jobs == 1
        assert resp.enabled_schedules == 1

    @pytest.mark.asyncio
    async def test_summary_counts_past_the_list_cap(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        queued_total = 55
        for _ in range(queued_total):
            await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.get_pipeline_summary(
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.queued_jobs == queued_total


class TestPipelineJobQueueEndpoint:
    @pytest.mark.asyncio
    async def test_job_queue_lists_active_and_failed_jobs_with_worker_context(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        queued_run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Detroit, MI",
            state="MI",
            issue_areas=["housing_affordability"],
        )
        running_run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Phoenix, AZ",
            state="AZ",
            issue_areas=["worker_power"],
        )
        completed_run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Milwaukee, WI",
            state="WI",
            issue_areas=["democracy"],
        )
        queued_job_id = await DiscoveryJobCRUD.create(test_db, run_id=queued_run_id)
        running_job_id = await DiscoveryJobCRUD.create(test_db, run_id=running_run_id)
        completed_job_id = await DiscoveryJobCRUD.create(test_db, run_id=completed_run_id)
        await test_db.execute(
            """
            UPDATE discovery_jobs
            SET status = 'running',
                progress = ?,
                claimed_by = ?,
                claimed_until = ?,
                started_at = ?
            WHERE id = ?
            """,
            (
                '{"step":"fetching_sources","sources":12}',
                "worker-a",
                "2026-07-03T12:15:00.000Z",
                "2026-07-03T12:00:00.000Z",
                running_job_id,
            ),
        )
        await DiscoveryJobCRUD.complete(test_db, completed_job_id)
        await test_db.commit()

        resp = await discovery_api.list_discovery_job_queue(
            response=None,
            actor=actor,
            db=test_db,
            limit=10,
        )

        expected_visible_jobs = 2
        assert resp.total == expected_visible_jobs
        assert resp.status_counts == {
            "queued": 1,
            "running": 1,
            "claimed": 0,
            "failed": 0,
        }
        assert [item.id for item in resp.items] == [running_job_id, queued_job_id]
        running_item = resp.items[0]
        assert running_item.run_id == running_run_id
        assert running_item.location_query == "Phoenix, AZ"
        assert running_item.state == "AZ"
        assert running_item.issue_areas == ["worker_power"]
        assert running_item.status == "running"
        assert running_item.progress == {"step": "fetching_sources", "sources": 12}
        assert running_item.claimed_by == "worker-a"
        assert running_item.claimed_until == "2026-07-03T12:15:00.000Z"

    @pytest.mark.asyncio
    async def test_job_queue_respects_limit(
        self, test_db: object, actor: AuthenticatedActor
    ) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await DiscoveryJobCRUD.create(test_db, run_id=run_id)

        resp = await discovery_api.list_discovery_job_queue(
            response=None,
            actor=actor,
            db=test_db,
            limit=1,
        )

        expected_total_jobs = 2
        assert resp.total == expected_total_jobs
        assert len(resp.items) == 1
