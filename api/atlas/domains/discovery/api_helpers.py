"""Discovery run endpoints."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

from atlas_shared import (
    RankedEntry,
    SyncedEntryLink,
)
from fastapi import APIRouter, Depends, HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
)
from atlas.domains.discovery.schemas import (
    DiscoveryJobQueueItemResponse,
    DiscoveryWorkerJobResponse,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.schemas import (
    DiscoveryRunResponse,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    import aiosqlite

    from atlas.domains.access import AuthenticatedActor
    from atlas.domains.discovery.models import (
        DiscoveryJobModel,
        DiscoveryJobQueueItemModel,
        DiscoveryRunModel,
    )

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]

SYNC_UPLOAD_TARGETS = frozenset({"public", "workspace"})
SyncEntryVisibility = Literal[
    "public",
    "held_for_review",
    "workspace_private",
    "existing_shared",
]


def _resolve_sync_destination(
    *,
    upload_target: str | None,
    workspace_id: str | None,
    actor: AuthenticatedActor,
) -> tuple[str | None, str | None]:
    """Validate and normalize Scout run-sync destination headers."""
    if not isinstance(upload_target, str):
        upload_target = None
    if not isinstance(workspace_id, str):
        workspace_id = None

    if upload_target is None:
        return None, None

    normalized_target = upload_target.strip().lower()
    if normalized_target not in SYNC_UPLOAD_TARGETS:
        raise HTTPException(status_code=400, detail="Invalid Scout upload target")

    if normalized_target == "public":
        return normalized_target, None

    resolved_workspace_id = workspace_id or actor.org_id
    if not resolved_workspace_id:
        raise HTTPException(status_code=400, detail="Workspace upload target requires workspace id")
    if actor.org_id is None:
        raise HTTPException(status_code=403, detail="Workspace upload target requires org context")
    if actor.org_id is not None and actor.org_id != resolved_workspace_id:
        raise HTTPException(status_code=403, detail="Workspace upload target does not match actor")
    return normalized_target, resolved_workspace_id


async def _ensure_workspace_run_ownership(
    db: aiosqlite.Connection,
    *,
    run_id: str,
    workspace_id: str | None,
    actor: AuthenticatedActor,
) -> None:
    """Attach a synced discovery run to a workspace as private owned work."""
    if workspace_id is None:
        return

    ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
    if ownership is not None:
        if ownership.org_id != workspace_id:
            raise HTTPException(
                status_code=409, detail="Discovery run belongs to another workspace"
            )
        return

    await OwnershipCRUD.create_ownership(
        db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id=workspace_id,
        visibility="private",
        created_by=actor.user_id,
    )


def _entry_profile_path(*, entry_type: str, slug: str | None) -> str | None:
    """Return the public profile path for visible entry types."""
    if not slug:
        return None
    if entry_type == "person":
        return f"/profiles/people/{slug}"
    if entry_type == "organization":
        return f"/profiles/organizations/{slug}"
    return None


def _entry_ids_from_run_summary(run: DiscoveryRunModel) -> list[str]:
    """Recover persisted entry ids from a completed discovery run summary."""
    summary = run.research_summary or {}
    ranked_leads = summary.get("ranked_leads")
    if not isinstance(ranked_leads, list):
        return []

    entry_ids: list[str] = []
    for lead in ranked_leads:
        if not isinstance(lead, dict):
            continue
        entry_id = lead.get("entry_id")
        if isinstance(entry_id, str) and entry_id:
            entry_ids.append(entry_id)
    return entry_ids


async def _entry_ids_from_artifacts(
    db: aiosqlite.Connection,
    ranked_entries: list[RankedEntry],
) -> list[str]:
    """Resolve persisted entry ids represented by an already-synced artifact bundle."""
    entry_ids: list[str] = []
    for ranked_entry in ranked_entries:
        entry = ranked_entry.entry
        candidates = await EntryCRUD.list(
            db,
            state=entry.state,
            city=entry.city,
            active_only=False,
            limit=500,
        )
        match = next(
            (
                candidate
                for candidate in candidates
                if candidate.type == str(entry.entry_type)
                and candidate.name.strip().lower() == entry.name.strip().lower()
            ),
            None,
        )
        if match is not None:
            entry_ids.append(str(match.id))
    return entry_ids


async def _sync_entry_visibility(
    db: aiosqlite.Connection,
    *,
    entry_id: str,
    workspace_id: str | None,
    actor: AuthenticatedActor,
) -> SyncEntryVisibility:
    """Resolve and, for workspace syncs, enforce the entry visibility receipt."""
    is_public = await EntryCRUD.is_publicly_visible(db, entry_id)
    if workspace_id is None:
        return "public" if is_public else "held_for_review"

    if is_public:
        return "existing_shared"

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is not None:
        if ownership.org_id != workspace_id and ownership.visibility == "private":
            raise HTTPException(status_code=409, detail="Synced entry belongs to another workspace")
        if ownership.org_id == workspace_id and ownership.visibility == "private":
            return "workspace_private"
        return "held_for_review"

    await OwnershipCRUD.create_ownership(
        db,
        resource_id=entry_id,
        resource_type="entry",
        org_id=workspace_id,
        visibility="private",
        created_by=actor.user_id,
    )
    return "workspace_private"


async def _sync_entry_links(
    db: aiosqlite.Connection,
    *,
    entry_ids: list[str],
    workspace_id: str | None,
    actor: AuthenticatedActor,
) -> list[SyncedEntryLink]:
    """Build developer-visible links for entries persisted during a sync."""
    links: list[SyncedEntryLink] = []
    for entry_id in entry_ids:
        entry = await EntryCRUD.get_by_id(db, entry_id)
        if entry is None:
            continue

        visibility = await _sync_entry_visibility(
            db,
            entry_id=entry_id,
            workspace_id=workspace_id,
            actor=actor,
        )
        url = (
            _entry_profile_path(entry_type=entry.type, slug=entry.slug)
            if visibility in {"public", "existing_shared"}
            else None
        )
        links.append(
            SyncedEntryLink(
                id=entry.id,
                name=entry.name,
                type=entry.type,
                slug=entry.slug,
                visibility=visibility,
                url=url,
            )
        )
    return links


async def _record_firehose_discovery_observations(
    db: aiosqlite.Connection,
    *,
    run_id: str,
    org_id: str | None,
    entry_links: list[SyncedEntryLink],
    issue_areas: list[str],
) -> None:
    """Record synced discovery entries as Firehose observations."""
    from atlas.domains.firehose.producers import record_discovery_actor_observation

    for link in entry_links:
        await record_discovery_actor_observation(
            db,
            org_id=org_id,
            run_id=run_id,
            entry_id=link.id,
            entry_name=link.name,
            places=[],
            issues=issue_areas,
        )


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _job_queue_item_to_response(job: DiscoveryJobQueueItemModel) -> DiscoveryJobQueueItemResponse:
    """Convert a discovery job queue item into an API response."""
    return DiscoveryJobQueueItemResponse(
        id=job.id,
        run_id=job.run_id,
        status=job.status,
        execution_mode=job.execution_mode,
        input_payload=job.input_payload,
        progress=job.progress,
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        location_query=job.location_query,
        state=job.state,
        issue_areas=job.issue_areas,
        claimed_by=job.claimed_by,
        claimed_until=job.claimed_until,
        next_attempt_at=job.next_attempt_at,
    )


async def _worker_job_to_response(
    db: aiosqlite.Connection,
    job: DiscoveryJobModel,
) -> DiscoveryWorkerJobResponse:
    """Convert a leased discovery job into the Scout worker response shape."""
    run = await DiscoveryRunCRUD.get_by_id(db, job.run_id)
    if run is None:
        raise HTTPException(status_code=500, detail="Discovery job has no run")
    return DiscoveryWorkerJobResponse(
        id=job.id,
        run_id=job.run_id,
        status=job.status,
        execution_mode=job.execution_mode,
        input_payload=job.input_payload,
        progress=job.progress,
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        location_query=run.location_query,
        state=run.state,
        issue_areas=run.issue_areas,
        research_goal=run.research_goal,
        claimed_by=job.claimed_by,
        claimed_until=job.claimed_until,
        next_attempt_at=job.next_attempt_at,
    )


async def _require_worker_job(
    db: aiosqlite.Connection,
    *,
    job_id: str,
    worker_id: str,
) -> DiscoveryJobModel:
    """Return a worker-owned job lease or raise a precise API error."""
    job = await DiscoveryJobCRUD.get_by_id(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in {"claimed", "running"}:
        raise HTTPException(status_code=409, detail="Job is not leased")
    if job.claimed_by != worker_id:
        raise HTTPException(status_code=409, detail="Job is leased by another worker")
    return job


def _run_to_response(run: DiscoveryRunModel) -> DiscoveryRunResponse:
    """Convert DiscoveryRunModel to DiscoveryRunResponse."""
    return DiscoveryRunResponse(
        id=run.id,
        location_query=run.location_query,
        state=run.state,
        research_goal=run.research_goal,
        issue_areas=run.issue_areas,
        queries_generated=run.queries_generated,
        sources_fetched=run.sources_fetched,
        sources_processed=run.sources_processed,
        entries_extracted=run.entries_extracted,
        entries_after_dedup=run.entries_after_dedup,
        entries_confirmed=run.entries_confirmed,
        started_at=run.started_at,
        completed_at=run.completed_at,
        status=run.status,
        error_message=run.error_message,
        created_at=run.created_at,
        research_summary=run.research_summary,
    )
