"""HTTP client for the Atlas worker job-claim API."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from atlas_scout.auth import DeviceAuthClient
from atlas_scout.auth_commands import _default_worker_name
from atlas_scout.worker.errors import WorkerJobError

if TYPE_CHECKING:
    from atlas_scout.auth import ScoutSession, UploadTarget


async def _worker_api_token(
    *,
    atlas_url: str,
    session: ScoutSession,
    search_api_key: str,
) -> str:
    """Exchange the saved Scout session for a short-lived API token."""
    default_upload_target: UploadTarget = session.default_upload_target or "public"
    workspace_id = session.workspace_id if default_upload_target == "workspace" else None
    exchange = await DeviceAuthClient().exchange_session_for_api_token(
        atlas_url,
        session_token=session.access_token,
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        default_upload_target=default_upload_target,
        workspace_id=workspace_id,
        search_key_configured=bool(search_api_key),
    )
    return exchange.token


async def _worker_post(
    *,
    atlas_url: str,
    token: str,
    path: str,
    payload: dict[str, object],
) -> dict[str, object]:
    """POST to the Atlas worker API and return a JSON object."""
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{atlas_url.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.is_error:
        raise WorkerJobError(f"Atlas worker API failed: HTTP {response.status_code}")
    body = response.json()
    if not isinstance(body, dict):
        raise WorkerJobError("Atlas worker API returned an invalid response.")
    return cast("dict[str, object]", body)


async def _worker_claim_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    lease_seconds: int,
    search_key_configured: bool,
) -> dict[str, object] | None:
    """Claim the next Atlas discovery job, if any."""
    body = await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path="/api/discovery-runs/jobs/claim",
        payload={
            "worker_id": worker_id,
            "lease_seconds": lease_seconds,
            "search_key_configured": search_key_configured,
        },
    )
    job = body.get("job")
    if job is None:
        return None
    if not isinstance(job, dict):
        raise WorkerJobError("Atlas worker claim returned an invalid job.")
    return cast("dict[str, object]", job)


async def _worker_heartbeat_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
    lease_seconds: int,
    progress: dict[str, object],
) -> None:
    """Renew one Atlas job lease."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/heartbeat",
        payload={
            "worker_id": worker_id,
            "lease_seconds": lease_seconds,
            "progress": progress,
        },
    )


async def _worker_complete_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
) -> None:
    """Mark one Atlas job lease complete."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/complete",
        payload={"worker_id": worker_id},
    )


async def _worker_fail_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
    error_message: str,
    retryable: bool,
) -> None:
    """Report one failed Atlas job lease."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/fail",
        payload={
            "worker_id": worker_id,
            "error_message": error_message,
            "retryable": retryable,
        },
    )
