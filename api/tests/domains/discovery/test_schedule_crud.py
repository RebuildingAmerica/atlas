"""Tests for DiscoveryScheduleCRUD and DiscoveryJobCRUD."""

from __future__ import annotations

import tempfile

import pytest
import pytest_asyncio

from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryScheduleCRUD,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection, init_db

EXPECTED_TWO_ITEMS = 2
EXPECTED_DEFAULT_MAX_RETRIES = 2


@pytest_asyncio.fixture
async def db() -> object:
    """Create a temporary test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        url = f"sqlite:///{f.name}"
    await init_db(url)
    conn = await get_db_connection(url)
    try:
        yield conn
    finally:
        await conn.close()


class TestDiscoveryScheduleCRUD:
    @pytest.mark.asyncio
    async def test_create_and_get(self, db: object) -> None:
        schedule_id = await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        assert schedule_id

        schedule = await DiscoveryScheduleCRUD.get_by_id(db, schedule_id)
        assert schedule is not None
        assert schedule.location_query == "Austin, TX"
        assert schedule.state == "TX"
        assert schedule.issue_areas == ["housing_affordability"]
        assert schedule.search_depth == "standard"
        assert schedule.enabled is True
        assert schedule.last_run_id is None

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, db: object) -> None:
        assert await DiscoveryScheduleCRUD.get_by_id(db, "nonexistent") is None

    @pytest.mark.asyncio
    async def test_list_all(self, db: object) -> None:
        await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryScheduleCRUD.create(
            db,
            location_query="Denver, CO",
            state="CO",
            issue_areas=["worker_cooperatives"],
        )
        schedules = await DiscoveryScheduleCRUD.list(db)
        assert len(schedules) == EXPECTED_TWO_ITEMS

    @pytest.mark.asyncio
    async def test_list_enabled_only(self, db: object) -> None:
        sid1 = await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryScheduleCRUD.create(
            db,
            location_query="Denver, CO",
            state="CO",
            issue_areas=["worker_cooperatives"],
        )
        await DiscoveryScheduleCRUD.update(db, sid1, enabled=False)

        enabled = await DiscoveryScheduleCRUD.list(db, enabled_only=True)
        assert len(enabled) == 1
        assert enabled[0].location_query == "Denver, CO"

    @pytest.mark.asyncio
    async def test_update_fields(self, db: object) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        updated = await DiscoveryScheduleCRUD.update(
            db,
            sid,
            location_query="San Antonio, TX",
            search_depth="deep",
        )
        assert updated is True

        schedule = await DiscoveryScheduleCRUD.get_by_id(db, sid)
        assert schedule is not None
        assert schedule.location_query == "San Antonio, TX"
        assert schedule.search_depth == "deep"

    @pytest.mark.asyncio
    async def test_update_issue_areas(self, db: object) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryScheduleCRUD.update(
            db,
            sid,
            issue_areas=["worker_cooperatives", "housing_affordability"],
        )
        schedule = await DiscoveryScheduleCRUD.get_by_id(db, sid)
        assert schedule is not None
        assert set(schedule.issue_areas) == {"worker_cooperatives", "housing_affordability"}

    @pytest.mark.asyncio
    async def test_update_nonexistent_returns_false(self, db: object) -> None:
        assert await DiscoveryScheduleCRUD.update(db, "nope", enabled=False) is False

    @pytest.mark.asyncio
    async def test_delete(self, db: object) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        assert await DiscoveryScheduleCRUD.delete(db, sid) is True
        assert await DiscoveryScheduleCRUD.get_by_id(db, sid) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_returns_false(self, db: object) -> None:
        assert await DiscoveryScheduleCRUD.delete(db, "nope") is False

    @pytest.mark.asyncio
    async def test_create_with_deep_depth(self, db: object) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
            search_depth="deep",
        )
        schedule = await DiscoveryScheduleCRUD.get_by_id(db, sid)
        assert schedule is not None
        assert schedule.search_depth == "deep"


class TestDiscoveryJobCRUD:
    @pytest.mark.asyncio
    async def test_create_and_get(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(db, run_id=run_id)
        assert job_id

        job = await DiscoveryJobCRUD.get_by_id(db, job_id)
        assert job is not None
        assert job.run_id == run_id
        assert job.status == "queued"
        assert job.retry_count == 0
        assert job.max_retries == EXPECTED_DEFAULT_MAX_RETRIES

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, db: object) -> None:
        assert await DiscoveryJobCRUD.get_by_id(db, "nonexistent") is None

    @pytest.mark.asyncio
    async def test_get_by_run_id(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(db, run_id=run_id)

        job = await DiscoveryJobCRUD.get_by_run_id(db, run_id)
        assert job is not None
        assert job.id == job_id

    @pytest.mark.asyncio
    async def test_claim_next_picks_oldest_queued(self, db: object) -> None:
        run_id1 = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        run_id2 = await DiscoveryRunCRUD.create(
            db,
            location_query="Denver, CO",
            state="CO",
            issue_areas=["worker_cooperatives"],
        )
        job_id1 = await DiscoveryJobCRUD.create(db, run_id=run_id1)
        await DiscoveryJobCRUD.create(db, run_id=run_id2)

        claimed = await DiscoveryJobCRUD.claim_next(db, claimed_by="worker-1")
        assert claimed is not None
        assert claimed.id == job_id1
        assert claimed.status == "claimed"
        assert claimed.claimed_by == "worker-1"

    @pytest.mark.asyncio
    async def test_claim_next_returns_none_when_empty(self, db: object) -> None:
        claimed = await DiscoveryJobCRUD.claim_next(db, claimed_by="worker-1")
        assert claimed is None

    @pytest.mark.asyncio
    async def test_update_progress(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(db, run_id=run_id)
        await DiscoveryJobCRUD.update_progress(db, job_id, {"step": "extraction", "count": 5})

        job = await DiscoveryJobCRUD.get_by_id(db, job_id)
        assert job is not None
        assert job.status == "running"
        assert job.progress is not None
        assert job.progress["step"] == "extraction"

    @pytest.mark.asyncio
    async def test_complete(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(db, run_id=run_id)
        await DiscoveryJobCRUD.complete(db, job_id)

        job = await DiscoveryJobCRUD.get_by_id(db, job_id)
        assert job is not None
        assert job.status == "completed"
        assert job.completed_at is not None

    @pytest.mark.asyncio
    async def test_fail_with_retry(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(db, run_id=run_id, max_retries=2)

        requeued = await DiscoveryJobCRUD.fail(db, job_id, "transient error")
        assert requeued is True

        job = await DiscoveryJobCRUD.get_by_id(db, job_id)
        assert job is not None
        assert job.status == "queued"
        assert job.retry_count == 1

    @pytest.mark.asyncio
    async def test_fail_permanently_after_max_retries(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(db, run_id=run_id, max_retries=1)

        await DiscoveryJobCRUD.fail(db, job_id, "error 1")  # retry_count=1, max=1 → requeued
        requeued = await DiscoveryJobCRUD.fail(
            db, job_id, "error 2"
        )  # retry_count=2, max=1 → permanent
        assert requeued is False

        job = await DiscoveryJobCRUD.get_by_id(db, job_id)
        assert job is not None
        assert job.status == "failed"
        assert job.error_message == "error 2"
        assert job.completed_at is not None

    @pytest.mark.asyncio
    async def test_list_by_status(self, db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryJobCRUD.create(db, run_id=run_id)
        await DiscoveryJobCRUD.create(db, run_id=run_id)

        queued = await DiscoveryJobCRUD.list_by_status(db, "queued")
        assert len(queued) == EXPECTED_TWO_ITEMS

        running = await DiscoveryJobCRUD.list_by_status(db, "running")
        assert len(running) == 0

    @pytest.mark.asyncio
    async def test_fail_nonexistent_returns_false(self, db: object) -> None:
        assert await DiscoveryJobCRUD.fail(db, "nope", "error") is False
