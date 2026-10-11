"""Explicit one-turn consumer for durable discovery without process poll loops."""

from __future__ import annotations

import hashlib
import json
from contextlib import suppress
from dataclasses import asdict
from datetime import date
from typing import TYPE_CHECKING, Literal, cast

from atlas_shared import PageContent
from pydantic import BaseModel, TypeAdapter

from atlas.domains.discovery.cost import CostCeilingExceeded
from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.models_job_core import _retry_backoff_at
from atlas.domains.discovery.resolution.mentions import (
    OrganizationMention,
    PersonMention,
    RoleMention,
)
from atlas.models import DiscoveryRunCRUD
from atlas.platform.database import db

from .continuation_plan import PublicationPlan, prepare_publication_plan
from .discovery_completion import DiscoveryCompletionReceipt, finalize_discovery_job
from .registry_checkpoints import advance_registry_discovery
from .registry_publication import _UnitConnection, publish_registry_mention
from .registry_stage import RegistryDiscovery
from .runner import DiscoveryPipelineJob
from .web_checkpoints import (
    CheckpointLeaseLostError,
    WebDiscovery,
    _Checkpoints,
    advance_web_discovery,
)
from .web_publication import publish_web_entry

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.platform.config import Settings

    from .runner import DiscoveryPipelineCredentials

_KEY = "continuation"
Phase = Literal[
    "web", "registry", "organizations", "people", "ranking", "web_publication", "completion"
]


class _Continuation(BaseModel):
    phase: Phase = "web"
    index: int = 0
    web: WebDiscovery | None = None
    registry: RegistryDiscovery | None = None
    plan: PublicationPlan | None = None


_Continuation.model_rebuild(
    _types_namespace={
        "date": date,
        "PageContent": PageContent,
        "OrganizationMention": OrganizationMention,
        "PersonMention": PersonMention,
        "RoleMention": RoleMention,
        "RegistryDiscovery": RegistryDiscovery,
    }
)


class DiscoveryTurnResult(BaseModel):
    """Whether a scheduler should claim the next turn or stop this job."""

    status: Literal["yielded", "completed", "retry", "failed"]
    phase: str
    completion: DiscoveryCompletionReceipt | None = None


def _fingerprint(job: DiscoveryPipelineJob, settings: Settings) -> str:
    return hashlib.sha256(
        json.dumps(
            {
                "version": 1,
                "job": asdict(job),
                "queries": settings.discovery_max_queries_per_run,
                "organizations": settings.discovery_registry_max_organizations,
                "people": settings.discovery_registry_max_people,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


async def _advance(  # noqa: PLR0911, PLR0912, PLR0913 - one explicit branch per durable stage
    conn: Connection,
    store: _Checkpoints,
    state: _Continuation,
    job: DiscoveryPipelineJob,
    settings: Settings,
    credentials: DiscoveryPipelineCredentials | None,
) -> DiscoveryCompletionReceipt | None:
    base = {"job_id": store.job_id, "claimed_by": store.owner}
    if state.phase == "web":
        state.web = await advance_web_discovery(
            conn, **base, job=job, settings=settings, credentials=credentials
        )
        if state.web is not None:
            state.phase = "registry"
        return None
    assert state.web is not None
    today = state.web.started_at.date()
    if state.phase == "registry":
        state.registry = await advance_registry_discovery(
            conn, **base, job=job, settings=settings, today=today
        )
        if state.registry is not None:
            state.phase = "organizations"
        return None
    assert state.registry is not None
    if state.phase == "organizations":
        if state.index < len(state.registry.organizations):
            await publish_registry_mention(
                conn,
                **base,
                run_id=job.run_id,
                unit_key=f"org:{state.index}",
                mention=state.registry.organizations[state.index],
                issue_areas=job.issue_areas,
                today=today,
            )
            state.index += 1
        else:
            state.phase, state.index = "people", 0
        return None
    if state.phase == "people":
        if state.index < len(state.registry.people):
            person = state.registry.people[state.index]
            parent_index = next(
                index
                for index, organization in enumerate(state.registry.organizations)
                if organization.ein == person.organization.ein
            )
            await publish_registry_mention(
                conn,
                **base,
                run_id=job.run_id,
                unit_key=f"person:{state.index}",
                mention=person,
                issue_areas=job.issue_areas,
                today=today,
                organization_unit_key=f"org:{parent_index}",
            )
            state.index += 1
        else:
            state.phase, state.index = "ranking", 0
        return None
    if state.phase == "ranking":
        state.plan = await prepare_publication_plan(conn, job, state.web, state.registry)
        state.phase = "web_publication"
        return None
    assert state.plan is not None
    if state.phase == "web_publication":
        if state.index < len(state.plan.artifacts.ranked_entries):
            await publish_web_entry(
                conn,
                **base,
                run_id=job.run_id,
                index=state.index,
                ranked=state.plan.artifacts.ranked_entries[state.index],
                sources=state.plan.artifacts.sources,
                today=today,
                dedup_note=state.plan.dedup_notes[state.index],
            )
            state.index += 1
        else:
            state.phase = "completion"
        return None
    return await finalize_discovery_job(
        conn,
        **base,
        run_id=job.run_id,
        artifacts=state.plan.artifacts,
        registry=state.registry,
        today=today,
        dedup_notes=state.plan.dedup_notes,
        empty_fetch_reason=state.web.search_failure,
    )


async def _yield(conn: Connection, store: _Checkpoints, phase: str) -> None:
    try:
        await store.fence()
        await conn.execute(
            "UPDATE discovery_jobs SET status = 'queued', claimed_by = NULL, claimed_until = NULL, next_attempt_at = NULL, progress = ? WHERE id = ?",
            (db.encode_json({"step": phase, "run_id": store.run_id}), store.job_id),
        )
        await conn.commit()
    except BaseException:
        with suppress(Exception):
            await conn.execute("ROLLBACK")
        raise


async def _fail(conn: Connection, store: _Checkpoints, error: str, *, retryable: bool) -> bool:
    try:
        await store.fence()
        job = await DiscoveryJobCRUD.get_by_id(conn, store.job_id)
        assert job is not None
        retry_count = job.retry_count + 1
        retry = retryable and retry_count <= job.max_retries
        unit = cast("Connection", _UnitConnection(conn))
        await DiscoveryRunCRUD.fail(unit, store.run_id, error)
        await store.fence()
        await conn.execute(
            "UPDATE discovery_jobs SET status = ?, retry_count = ?, error_message = ?, claimed_by = NULL, claimed_until = NULL, next_attempt_at = ?, completed_at = ? WHERE id = ?",
            (
                "queued" if retry else "failed",
                retry_count,
                error,
                _retry_backoff_at(job.id, retry_count) if retry else None,
                None if retry else db.now_iso(),
                job.id,
            ),
        )
        await conn.commit()
    except BaseException:
        with suppress(Exception):
            await conn.execute("ROLLBACK")
        raise
    else:
        return retry


async def advance_claimed_discovery_job(
    conn: Connection,
    *,
    job_id: str,
    claimed_by: str,
    settings: Settings,
    credentials: DiscoveryPipelineCredentials | None = None,
) -> DiscoveryTurnResult:
    """Advance one claimed search job, then release its lease without a retry.

    Parameters
    ----------
    conn
        Invocation-owned connection, closed by the caller after each turn.
    job_id, claimed_by
        Job claimed with DiscoveryJobCRUD.claim_next(checkpointed=True) and a
        unique invocation owner. Legacy claimers cannot take enrolled jobs.
    settings, credentials
        Current safety ceilings and invocation-owned vendor credentials. No
        credentials enter the continuation. Research inputs/budgets are frozen.

    Returns
    -------
    DiscoveryTurnResult
        Deliberate yield, terminal completion, or the existing retry/backoff
        outcome. Cancellation and lost leases propagate without reviving jobs.
        No alarm or process polling is started. Ranking remains a whole-run
        synchronous unit requiring hosted CPU/memory validation.
    """
    queued = await DiscoveryJobCRUD.get_by_id(conn, job_id)
    if queued is None or queued.execution_mode != "search":
        raise CheckpointLeaseLostError
    if queued.status == "completed":
        cursor = await conn.execute(
            "SELECT result FROM discovery_web_checkpoints WHERE job_id = ? AND unit_key = 'publication:complete'",
            (job_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            raise CheckpointLeaseLostError
        return DiscoveryTurnResult(
            status="completed",
            phase="completion",
            completion=DiscoveryCompletionReceipt.model_validate_json(row[0]),
        )
    run = await DiscoveryRunCRUD.get_by_id(conn, queued.run_id)
    assert run is not None
    job = DiscoveryPipelineJob(
        run.id, run.location_query, run.state, run.issue_areas, run.research_goal
    )
    store = _Checkpoints(conn, job_id, claimed_by, job.run_id, _fingerprint(job, settings))
    codec = TypeAdapter(_Continuation)
    state = await store.load(_KEY, codec)
    if state is None:
        state = _Continuation()
        # Enroll before any provider or publication work, excluding legacy
        # monolithic claimers after a crash or a deliberate yield.
        await store.save(_KEY, state, codec)
    try:
        completion = await _advance(conn, store, state, job, settings, credentials)
    except CheckpointLeaseLostError:
        raise
    except CostCeilingExceeded as error:
        await _fail(conn, store, f"cost_ceiling:{error.scope}", retryable=False)
        return DiscoveryTurnResult(status="failed", phase=state.phase)
    except Exception as error:
        retry = await _fail(conn, store, str(error)[:500], retryable=True)
        return DiscoveryTurnResult(status="retry" if retry else "failed", phase=state.phase)
    if completion is not None:
        return DiscoveryTurnResult(status="completed", phase="completion", completion=completion)
    await store.save(_KEY, state, codec)
    await _yield(conn, store, state.phase)
    return DiscoveryTurnResult(status="yielded", phase=state.phase)
