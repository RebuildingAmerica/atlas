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
        resp = await discovery_api.execute_scheduled_runs(
            response=None,
            actor=actor,
            settings=settings,
            db=test_db,
        )
        assert resp.runs_started == 0
        assert resp.results == []


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
