"""Tests for the discovery job worker."""

from __future__ import annotations

import asyncio
import tempfile

import pytest
import pytest_asyncio

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.worker import start_job_worker, stop_job_worker
from atlas.models import DiscoveryRunCRUD, get_db_connection, init_db


@pytest_asyncio.fixture
async def db_url() -> str:
    """Create a temporary test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        url = f"sqlite:///{f.name}"
    await init_db(url)
    return url


class TestWorkerLifecycle:
    @pytest.mark.asyncio
    async def test_start_and_stop(self, db_url: str) -> None:
        await start_job_worker(db_url, anthropic_api_key="test")
        # Give it a moment to start polling
        await asyncio.sleep(0.05)
        await stop_job_worker()

    @pytest.mark.asyncio
    async def test_double_start_is_safe(self, db_url: str) -> None:
        await start_job_worker(db_url, anthropic_api_key="test")
        await start_job_worker(db_url, anthropic_api_key="test")  # should not raise
        await stop_job_worker()

    @pytest.mark.asyncio
    async def test_stop_without_start_is_safe(self) -> None:
        await stop_job_worker()  # should not raise


class TestWorkerExecution:
    @pytest.mark.asyncio
    async def test_worker_claims_and_fails_job_with_retry(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Worker should claim a queued job, attempt to run, and re-queue on failure."""
        conn = await get_db_connection(db_url)
        run_id = await DiscoveryRunCRUD.create(
            conn,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=1)
        await conn.close()

        # Make the pipeline always fail
        async def fake_pipeline(
            _conn: object,
            *,
            job: object,  # noqa: ARG001
            credentials: object,  # noqa: ARG001
        ) -> None:
            msg = "test failure"
            raise RuntimeError(msg)

        monkeypatch.setattr(
            "atlas.domains.discovery.worker.run_discovery_pipeline",
            fake_pipeline,
        )

        # Run the worker briefly
        await start_job_worker(db_url, anthropic_api_key="test")
        await asyncio.sleep(0.5)
        await stop_job_worker()

        # Check the job was attempted and re-queued
        conn = await get_db_connection(db_url)
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        await conn.close()

        assert job is not None
        # Either re-queued (retry_count=1, status=queued) or failed permanently
        assert job.retry_count >= 1
        assert job.error_message is not None
        assert "test failure" in job.error_message
