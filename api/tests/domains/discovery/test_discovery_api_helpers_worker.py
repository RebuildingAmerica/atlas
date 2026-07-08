"""Tests for discovery API helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryRunCRUD


@pytest.mark.asyncio
async def test_worker_job_to_response_rejects_jobs_without_runs(
    test_db: object,
) -> None:
    """A leased job without a corresponding run should fail closed."""
    job = SimpleNamespace(
        id="job-1",
        run_id="run-1",
        status="claimed",
        execution_mode="manual",
        input_payload={},
        progress=0,
        error_message=None,
        retry_count=0,
        max_retries=3,
        created_at="2026-01-01T00:00:00Z",
        started_at=None,
        completed_at=None,
        claimed_by="worker-a",
        claimed_until=None,
        next_attempt_at=None,
    )

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(DiscoveryRunCRUD, "get_by_id", AsyncMock(return_value=None))
        with pytest.raises(HTTPException) as exc_info:
            await discovery_api._worker_job_to_response(test_db, job)

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_require_worker_job_rejects_missing_and_foreign_leases(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Worker leases should fail loudly when the job is missing or not owned."""

    job_result: object | None = None

    async def fake_get_by_id(_db: object, _job_id: str) -> object | None:
        return job_result

    monkeypatch.setattr(discovery_api.DiscoveryJobCRUD, "get_by_id", fake_get_by_id)

    with pytest.raises(HTTPException) as exc_info:
        await discovery_api._require_worker_job(
            test_db,
            job_id="missing",
            worker_id="worker-a",
        )
    assert exc_info.value.status_code == 404

    job_result = SimpleNamespace(
        status="completed",
        claimed_by="worker-a",
    )
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api._require_worker_job(
            test_db,
            job_id="completed",
            worker_id="worker-a",
        )
    assert exc_info.value.status_code == 409

    job_result = SimpleNamespace(
        status="claimed",
        claimed_by="worker-b",
    )
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api._require_worker_job(
            test_db,
            job_id="foreign",
            worker_id="worker-a",
        )
    assert exc_info.value.status_code == 409
