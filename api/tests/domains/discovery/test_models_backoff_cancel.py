"""Tests for discovery job backoff and cancel behavior."""

from __future__ import annotations

import pytest

from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD
from atlas.models.database import get_db_connection

EXPECTED_CANCELLED_JOB_COUNT = 2


class TestDiscoveryJobCRUDFailBackoff:
    @pytest.mark.asyncio
    async def test_requeued_job_gets_future_next_attempt_at(self, db_url: str) -> None:
        from datetime import UTC, datetime

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is True
        assert job is not None
        assert job.status == "queued"
        assert job.next_attempt_at is not None
        assert datetime.fromisoformat(job.next_attempt_at) > datetime.now(UTC)

    @pytest.mark.asyncio
    async def test_requeued_job_is_not_claimed_before_backoff(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()

        assert claimed is None

    @pytest.mark.asyncio
    async def test_dead_lettered_job_has_no_next_attempt_at(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=0)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is False
        assert job is not None
        assert job.status == "failed"
        assert job.next_attempt_at is None

    @pytest.mark.asyncio
    async def test_backoff_caps_at_five_minutes(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=20)
            await conn.execute(
                "UPDATE discovery_jobs SET retry_count = 15 WHERE id = ?",
                (job_id,),
            )
            await conn.commit()
            before = datetime.now(UTC)
            await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert job is not None
        assert job.next_attempt_at is not None
        delay = datetime.fromisoformat(job.next_attempt_at) - before
        # Cap is 300s of exponential backoff plus up to 4s of deterministic jitter.
        assert delay <= timedelta(seconds=305)


class TestDiscoveryJobCRUDCancel:
    @pytest.mark.asyncio
    async def test_cancel_queued_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            cancelled = await DiscoveryJobCRUD.cancel(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert cancelled is True
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_running_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running' WHERE id = ?", (job_id,)
            )
            await conn.commit()
            cancelled = await DiscoveryJobCRUD.cancel(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert cancelled is True
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_completed_job_is_noop(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.complete(conn, job_id)
            cancelled = await DiscoveryJobCRUD.cancel(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert cancelled is False
        assert job is not None
        assert job.status == "completed"

    @pytest.mark.asyncio
    async def test_cancel_unknown_job_returns_false(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            cancelled = await DiscoveryJobCRUD.cancel(conn, "no-such-job")
        finally:
            await conn.close()

        assert cancelled is False

    @pytest.mark.asyncio
    async def test_cancelled_job_is_not_claimed(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()

        assert claimed is None

    @pytest.mark.asyncio
    async def test_cancel_run_jobs_cancels_active_jobs(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            queued_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            running_id = await DiscoveryJobCRUD.create(
                conn, run_id=run_id, idempotency_key="k-running"
            )
            done_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, idempotency_key="k-done")
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running' WHERE id = ?", (running_id,)
            )
            await conn.commit()
            await DiscoveryJobCRUD.complete(conn, done_id)

            count = await DiscoveryJobCRUD.cancel_run_jobs(conn, run_id)
            queued = await DiscoveryJobCRUD.get_by_id(conn, queued_id)
            running = await DiscoveryJobCRUD.get_by_id(conn, running_id)
            done = await DiscoveryJobCRUD.get_by_id(conn, done_id)
        finally:
            await conn.close()

        assert count == EXPECTED_CANCELLED_JOB_COUNT
        assert queued is not None
        assert queued.status == "cancelled"
        assert running is not None
        assert running.status == "cancelled"
        assert done is not None
        assert done.status == "completed"

    @pytest.mark.asyncio
    async def test_complete_after_cancel_does_not_resurrect_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            await DiscoveryJobCRUD.complete(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_fail_after_cancel_does_not_resurrect_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is False
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_fail_dead_letter_after_cancel_does_not_resurrect_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=0)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is False
        assert job is not None
        assert job.status == "cancelled"
