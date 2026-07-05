"""Tests for Scout worker job-lease endpoints."""

from __future__ import annotations

import tempfile

import pytest
import pytest_asyncio
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.domains.discovery.schemas import (
    DiscoveryWorkerClaimRequest,
    DiscoveryWorkerCompleteRequest,
    DiscoveryWorkerFailRequest,
    DiscoveryWorkerHeartbeatRequest,
    DiscoveryWorkerReleaseResponse,
)
from atlas.models import DiscoveryRunCRUD, get_db_connection, init_db

HTTP_CONFLICT = 409


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
    """Return a discovery-write actor."""
    return AuthenticatedActor(
        user_id="test-user",
        email="test@example.com",
        auth_type="local",
        permissions={"discovery": ["read", "write"]},
    )


async def _queued_job(db: object) -> tuple[str, str]:
    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        research_goal="landscape_scan",
    )
    job_id = await DiscoveryJobCRUD.create(db, run_id=run_id)
    return run_id, job_id


@pytest.mark.asyncio
async def test_claim_discovery_job_returns_target_context(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    run_id, job_id = await _queued_job(test_db)

    response = await discovery_api.claim_discovery_job(
        DiscoveryWorkerClaimRequest(worker_id="worker-123", lease_seconds=120),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.job is not None
    assert response.job.id == job_id
    assert response.job.run_id == run_id
    assert response.job.location_query == "Austin, TX"
    assert response.job.state == "TX"
    assert response.job.issue_areas == ["housing_affordability"]
    assert response.job.research_goal == "landscape_scan"

    stored = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
    assert stored is not None
    assert stored.status == "claimed"
    assert stored.claimed_by == "worker-123"
    assert stored.claimed_until is not None


@pytest.mark.asyncio
async def test_claim_discovery_job_returns_empty_when_queue_is_empty(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    response = await discovery_api.claim_discovery_job(
        DiscoveryWorkerClaimRequest(worker_id="worker-123"),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.job is None


@pytest.mark.asyncio
async def test_claim_discovery_job_respects_search_capability(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    await _queued_job(test_db)
    direct_run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="",
        state="",
        issue_areas=[],
        research_goal="landscape_scan",
    )
    direct_job_id = await DiscoveryJobCRUD.create(test_db, run_id=direct_run_id)

    response = await discovery_api.claim_discovery_job(
        DiscoveryWorkerClaimRequest(worker_id="worker-123", search_key_configured=False),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.job is not None
    assert response.job.id == direct_job_id
    assert response.job.location_query == ""
    assert response.job.issue_areas == []


@pytest.mark.asyncio
async def test_claim_discovery_job_allows_direct_url_jobs_without_search_key(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    await _queued_job(test_db)
    direct_run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
        research_goal="landscape_scan",
    )
    direct_job_id = await DiscoveryJobCRUD.create(
        test_db,
        run_id=direct_run_id,
        job_input=DiscoveryJobInput(
            execution_mode="direct_url",
            payload={"direct_urls": ["https://example.test/seed"]},
        ),
    )

    response = await discovery_api.claim_discovery_job(
        DiscoveryWorkerClaimRequest(worker_id="worker-123", search_key_configured=False),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.job is not None
    assert response.job.id == direct_job_id
    assert response.job.location_query == "Austin, TX"
    assert response.job.issue_areas == ["housing_affordability"]
    assert response.job.execution_mode == "direct_url"
    assert response.job.input_payload == {"direct_urls": ["https://example.test/seed"]}


@pytest.mark.asyncio
async def test_heartbeat_renews_only_the_claiming_worker(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    _, job_id = await _queued_job(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="worker-123")

    response = await discovery_api.heartbeat_discovery_job(
        job_id,
        DiscoveryWorkerHeartbeatRequest(
            worker_id="worker-123",
            progress={"step": "fetching_sources", "sources": 12},
            lease_seconds=120,
        ),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.status == "running"
    assert response.progress == {"step": "fetching_sources", "sources": 12}

    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.heartbeat_discovery_job(
            job_id,
            DiscoveryWorkerHeartbeatRequest(worker_id="other-worker", progress={"step": "oops"}),
            response=None,
            actor=actor,
            db=test_db,
        )

    assert exc_info.value.status_code == HTTP_CONFLICT


@pytest.mark.asyncio
async def test_complete_discovery_job_requires_the_claiming_worker(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    _, job_id = await _queued_job(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="worker-123")

    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.complete_discovery_job(
            job_id,
            DiscoveryWorkerCompleteRequest(worker_id="other-worker"),
            response=None,
            actor=actor,
            db=test_db,
        )

    assert exc_info.value.status_code == HTTP_CONFLICT

    response = await discovery_api.complete_discovery_job(
        job_id,
        DiscoveryWorkerCompleteRequest(worker_id="worker-123"),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.status == "completed"
    assert response.completed_at is not None


@pytest.mark.asyncio
async def test_fail_discovery_job_requeues_retryable_errors(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    _, job_id = await _queued_job(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="worker-123")

    response = await discovery_api.fail_discovery_job(
        job_id,
        DiscoveryWorkerFailRequest(
            worker_id="worker-123",
            error_message="Search provider timed out",
            retryable=True,
        ),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.status == "queued"
    assert response.error_message == "Search provider timed out"
    assert response.retry_count == 1
    assert response.claimed_by is None
    assert response.claimed_until is None
    assert response.next_attempt_at is not None


@pytest.mark.asyncio
async def test_fail_discovery_job_dead_letters_non_retryable_errors(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    _, job_id = await _queued_job(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="worker-123")

    response = await discovery_api.fail_discovery_job(
        job_id,
        DiscoveryWorkerFailRequest(
            worker_id="worker-123",
            error_message="Unsupported job payload",
            retryable=False,
        ),
        response=None,
        actor=actor,
        db=test_db,
    )

    assert response.status == "failed"
    assert response.error_message == "Unsupported job payload"
    assert response.claimed_by is None
    assert response.claimed_until is None
    assert response.completed_at is not None


@pytest.mark.asyncio
async def test_release_worker_jobs_requeues_active_leases(
    test_db: object,
    actor: AuthenticatedActor,
) -> None:
    _, job_id = await _queued_job(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="worker-123")

    response = await discovery_api.release_worker_jobs(
        "worker-123",
        response=None,
        actor=actor,
        db=test_db,
    )

    assert isinstance(response, DiscoveryWorkerReleaseResponse)
    assert response.worker_id == "worker-123"
    assert response.jobs_released == 1

    stored = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
    assert stored is not None
    assert stored.status == "queued"
    assert stored.claimed_by is None
    assert stored.claimed_until is None
