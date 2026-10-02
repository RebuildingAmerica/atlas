"""A Scout job lease belongs to one enrolled worker, and revoking it ends its leases."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.discovery import api as discovery_api
from atlas.domains.discovery.models import DiscoveryJobCRUD, ScoutWorkerRevocationCRUD
from atlas.domains.discovery.schemas import (
    DiscoveryWorkerClaimRequest,
    DiscoveryWorkerCompleteRequest,
    DiscoveryWorkerFailRequest,
    DiscoveryWorkerHeartbeatRequest,
)
from atlas.models import DiscoveryRunCRUD

WORKER = "worker-enrolled-1"


def _scout(*, worker_id: str | None = WORKER, user_id: str = "volunteer-1") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id=user_id,
        email=f"{user_id}@example.org",
        auth_type="oauth_jwt",
        permissions={"discovery": ["read", "write"]},
        worker_id=worker_id,
    )


def _app_session(user_id: str = "volunteer-1") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id=user_id, email=f"{user_id}@example.org", auth_type="internal", account_ready=True
    )


async def _queued_job(db: object) -> str:
    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query="Reno, NV",
        state="NV",
        issue_areas=["public_transit"],
        research_goal="landscape_scan",
    )
    return await DiscoveryJobCRUD.create(db, run_id=run_id)


async def _claim(db: object, actor: AuthenticatedActor, worker_id: str = WORKER) -> object:
    return await discovery_api.claim_discovery_job(
        DiscoveryWorkerClaimRequest(worker_id=worker_id, lease_seconds=120),
        response=None,
        actor=actor,
        db=db,
    )


@pytest.mark.asyncio
async def test_an_enrolled_worker_claims_jobs_under_its_own_id(test_db: object) -> None:
    job_id = await _queued_job(test_db)

    response = await _claim(test_db, _scout())

    assert response.job is not None
    assert response.job.id == job_id


@pytest.mark.asyncio
async def test_a_token_from_no_enrolled_worker_cannot_claim_jobs(test_db: object) -> None:
    await _queued_job(test_db)

    with pytest.raises(HTTPException) as exc:
        await _claim(test_db, _scout(worker_id=None))

    assert exc.value.status_code == HTTPStatus.FORBIDDEN
    assert exc.value.detail == "Claiming Scout jobs needs a Scout worker sign-in."


@pytest.mark.asyncio
async def test_a_worker_cannot_claim_under_another_workers_id(test_db: object) -> None:
    await _queued_job(test_db)

    with pytest.raises(HTTPException) as exc:
        await _claim(test_db, _scout(), worker_id="someone-elses-worker")

    assert exc.value.status_code == HTTPStatus.FORBIDDEN
    assert exc.value.detail == "This Scout sign-in belongs to a different worker."


@pytest.mark.asyncio
async def test_a_revoked_worker_cannot_claim_again_even_with_an_unexpired_token(
    test_db: object,
) -> None:
    await _queued_job(test_db)
    await discovery_api.release_worker_jobs(WORKER, response=None, actor=_app_session(), db=test_db)

    with pytest.raises(HTTPException) as exc:
        await _claim(test_db, _scout())

    assert exc.value.status_code == HTTPStatus.FORBIDDEN
    assert exc.value.detail == "This Scout worker was revoked."


@pytest.mark.asyncio
async def test_someone_else_cannot_revoke_your_worker(test_db: object) -> None:
    await _queued_job(test_db)
    await discovery_api.release_worker_jobs(
        WORKER, response=None, actor=_app_session("stranger"), db=test_db
    )

    response = await _claim(test_db, _scout())

    assert response.job is not None


@pytest.mark.asyncio
async def test_revocation_is_recorded_once_per_owner(test_db: object) -> None:
    await ScoutWorkerRevocationCRUD.revoke(test_db, worker_id=WORKER, user_id="volunteer-1")
    await ScoutWorkerRevocationCRUD.revoke(test_db, worker_id=WORKER, user_id="volunteer-1")

    assert await ScoutWorkerRevocationCRUD.is_revoked(
        test_db, worker_id=WORKER, user_id="volunteer-1"
    )
    assert not await ScoutWorkerRevocationCRUD.is_revoked(
        test_db, worker_id=WORKER, user_id="volunteer-2"
    )


@pytest.mark.asyncio
async def test_lease_updates_need_the_claiming_workers_own_sign_in(test_db: object) -> None:
    job_id = await _queued_job(test_db)
    await _claim(test_db, _scout())
    impostor = _scout(worker_id="other-worker")

    for call in (
        discovery_api.heartbeat_discovery_job(
            job_id,
            DiscoveryWorkerHeartbeatRequest(worker_id=WORKER, progress={}, lease_seconds=120),
            response=None,
            actor=impostor,
            db=test_db,
        ),
        discovery_api.complete_discovery_job(
            job_id,
            DiscoveryWorkerCompleteRequest(worker_id=WORKER),
            response=None,
            actor=impostor,
            db=test_db,
        ),
        discovery_api.fail_discovery_job(
            job_id,
            DiscoveryWorkerFailRequest(worker_id=WORKER, error_message="x", retryable=True),
            response=None,
            actor=impostor,
            db=test_db,
        ),
    ):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.asyncio
async def test_single_user_mode_has_no_worker_enrollment_to_check(test_db: object) -> None:
    await _queued_job(test_db)
    local = AuthenticatedActor(user_id="local", email="", auth_type="local", is_local=True)

    response = await _claim(test_db, local)

    assert response.job is not None
