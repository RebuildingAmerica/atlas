"""Tests for the discovery job worker."""
# ruff: noqa

from __future__ import annotations

import asyncio
import tempfile
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.worker import _worker_loop, start_job_worker, stop_job_worker
from atlas.models import DiscoveryRunCRUD, get_db_connection, init_db

if TYPE_CHECKING:
    from collections.abc import Callable

_POLL_TEST_INTERVAL_SECONDS = 0.05
_WORKER_RECOVERY_TIMEOUT_SECONDS = 2.0
_EXPECTED_RECOVERY_DB_CONNECTION_ATTEMPTS = 2


@pytest_asyncio.fixture
async def db_url() -> str:
    """Create a temporary test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        url = f"sqlite:///{f.name}"
    await init_db(url)
    return url


async def _wait_until(predicate: Callable[[], bool], *, timeout_seconds: float) -> None:
    """Wait until a side-effect predicate becomes true."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(_POLL_TEST_INTERVAL_SECONDS)
    if predicate():
        return
    pytest.fail("Timed out waiting for worker side effect.")


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
    async def test_worker_loop_continues_when_no_job_is_claimed(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """An empty claim cycle should sleep and then keep polling."""
        claim_results = [None, None]
        sleep_calls = 0

        async def fake_claim_next(_conn: object, **_kwargs: object) -> object | None:
            return claim_results.pop(0)

        async def fake_sleep(_seconds: float) -> None:
            nonlocal sleep_calls
            sleep_calls += 1
            if sleep_calls == 2:
                raise asyncio.CancelledError

        monkeypatch.setattr(DiscoveryJobCRUD, "reap_orphans", AsyncMock(return_value=0))
        monkeypatch.setattr(DiscoveryJobCRUD, "claim_next", fake_claim_next)
        monkeypatch.setattr("atlas.domains.discovery.worker.asyncio.sleep", fake_sleep)

        with pytest.raises(asyncio.CancelledError):
            await _worker_loop(
                db_url,
                settings=SimpleNamespace(
                    database_url=db_url,
                    search_api_key=None,
                    anthropic_api_key="test",
                ),
            )

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
            settings: object,  # noqa: ARG001
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

    @pytest.mark.asyncio
    async def test_worker_dead_letters_job_with_no_retries(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A job with no retries that fails should be dead-lettered, not re-queued."""
        conn = await get_db_connection(db_url)
        run_id = await DiscoveryRunCRUD.create(
            conn,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=0)
        await conn.close()

        async def fake_pipeline(
            _conn: object,
            *,
            job: object,  # noqa: ARG001
            credentials: object,  # noqa: ARG001
            settings: object,  # noqa: ARG001
        ) -> None:
            msg = "permanent failure"
            raise RuntimeError(msg)

        monkeypatch.setattr(
            "atlas.domains.discovery.worker.run_discovery_pipeline",
            fake_pipeline,
        )

        await start_job_worker(db_url, anthropic_api_key="test")
        await asyncio.sleep(0.4)
        await stop_job_worker()

        conn = await get_db_connection(db_url)
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        await conn.close()

        assert job is not None
        assert job.status == "failed"
        assert job.error_message is not None
        assert "permanent failure" in job.error_message

    @pytest.mark.asyncio
    async def test_worker_completes_successful_job(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A pipeline that succeeds should mark the job complete."""
        conn = await get_db_connection(db_url)
        run_id = await DiscoveryRunCRUD.create(
            conn,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
        await conn.close()

        async def fake_pipeline(
            _conn: object,
            *,
            job: object,  # noqa: ARG001
            credentials: object,  # noqa: ARG001
            settings: object,  # noqa: ARG001
        ) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.discovery.worker.run_discovery_pipeline",
            fake_pipeline,
        )

        await start_job_worker(db_url, anthropic_api_key="test")
        await asyncio.sleep(0.4)
        await stop_job_worker()

        conn = await get_db_connection(db_url)
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        await conn.close()

        assert job is not None
        assert job.status == "completed"

    @pytest.mark.asyncio
    async def test_worker_reaps_stranded_running_job(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A running job with an expired lease is reaped and reclaimed by the worker."""
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        run_id = await DiscoveryRunCRUD.create(
            conn,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
        past = (datetime.now(UTC) - timedelta(seconds=10)).isoformat()
        await conn.execute(
            "UPDATE discovery_jobs SET status = 'running', claimed_by = 'dead-worker', "
            "claimed_until = ? WHERE id = ?",
            (past, job_id),
        )
        await conn.commit()
        await conn.close()

        async def fake_pipeline(
            _conn: object,
            *,
            job: object,  # noqa: ARG001
            credentials: object,  # noqa: ARG001
            settings: object,  # noqa: ARG001
        ) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.discovery.worker.run_discovery_pipeline",
            fake_pipeline,
        )

        await start_job_worker(db_url, anthropic_api_key="test")
        await asyncio.sleep(0.4)
        await stop_job_worker()

        conn = await get_db_connection(db_url)
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        await conn.close()

        assert job is not None
        # The stranded job was reaped, reclaimed, and run to completion.
        assert job.status == "completed"
        assert job.retry_count == 1

    @pytest.mark.asyncio
    async def test_worker_applies_cost_kill_switch_from_settings(
        self,
        db_url: str,
    ) -> None:
        """A worker booted with the kill switch on halts the run as a controlled stop."""
        from atlas.platform.config import Settings

        conn = await get_db_connection(db_url)
        run_id = await DiscoveryRunCRUD.create(
            conn,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
        await conn.close()

        settings = Settings(database_url=db_url, discovery_cost_kill_switch=True)

        await start_job_worker(db_url, anthropic_api_key="test", settings=settings)
        await asyncio.sleep(0.4)
        await stop_job_worker()

        conn = await get_db_connection(db_url)
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        run = await DiscoveryRunCRUD.get_by_id(conn, run_id)
        await conn.close()

        assert job is not None
        assert job.status == "completed"
        assert run is not None
        assert run.status == "failed"
        assert run.error_message == "cost_ceiling:kill_switch"

    @pytest.mark.asyncio
    async def test_worker_recovers_from_transient_db_failure(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A connection failure inside the loop should be logged without killing the worker."""
        from atlas.domains.discovery import worker as worker_module

        original_get_conn = worker_module.get_db_connection
        calls = {"n": 0}

        async def flaky(database_url: str, *, backend: str | None = None) -> object:
            calls["n"] += 1
            if calls["n"] == 1:
                msg = "transient db failure"
                raise RuntimeError(msg)
            return await original_get_conn(database_url, backend=backend)

        monkeypatch.setattr(worker_module, "get_db_connection", flaky)
        # Speed up the poll to keep the test short.
        monkeypatch.setattr(worker_module, "_POLL_INTERVAL_SECONDS", _POLL_TEST_INTERVAL_SECONDS)

        await start_job_worker(db_url, anthropic_api_key="test")
        await _wait_until(
            lambda: calls["n"] >= _EXPECTED_RECOVERY_DB_CONNECTION_ATTEMPTS,
            timeout_seconds=_WORKER_RECOVERY_TIMEOUT_SECONDS,
        )
        await stop_job_worker()

        assert calls["n"] >= _EXPECTED_RECOVERY_DB_CONNECTION_ATTEMPTS
