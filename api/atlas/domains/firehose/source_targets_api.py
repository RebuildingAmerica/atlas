"""Workspace Firehose source-target management API."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from atlas.domains.access import AuthenticatedActor, require_org_actor_permission
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

from .ingest import FirehoseFetchResult, FirehoseRunOnceResult, run_source_target_once
from .models import (
    FirehoseSourceKind,
    FirehoseSourcePriority,
    FirehoseSourceSafetyPolicy,
    FirehoseSourceTargetCreate,
    FirehoseSourceTargetCRUD,
    FirehoseSourceTargetModel,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    import aiosqlite

router = APIRouter()

__all__ = ["router"]


class FirehoseSourceTargetRequest(BaseModel):
    """Request to create or update a workspace Firehose source target."""

    coverage_target_id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    url: str = Field(..., min_length=1)
    source_kind: str = Field(..., pattern="^(rss|atom|web_page)$")
    source_class: str = Field(..., min_length=1)
    places: list[str] = Field(..., min_length=1)
    issues: list[str] = Field(..., min_length=1)
    priority: str = Field(default="hot", pattern="^(hot|warm)$")
    cadence_seconds: int = Field(default=60, ge=30, le=86400)
    enabled: bool = True
    safety_policy: str = Field(
        default="standard",
        pattern="^(standard|person_review_required|review_all)$",
    )
    public_route_enabled: bool = False
    origin_note: str | None = None


class FirehoseSourceTargetResponse(BaseModel):
    """Stored workspace Firehose source target."""

    id: str
    org_id: str
    coverage_target_id: str
    label: str
    url: str
    source_kind: str
    source_class: str
    places: list[str]
    issues: list[str]
    priority: str
    cadence_seconds: int
    enabled: bool
    safety_policy: str
    public_route_enabled: bool
    origin: str
    origin_note: str | None
    last_checked_at: str | None
    last_success_at: str | None
    last_error: str | None
    last_http_status: int | None
    etag: str | None
    last_modified: str | None
    content_hash: str | None
    created_by: str
    created_at: str
    updated_at: str


class FirehoseSourceTargetCollectionResponse(BaseModel):
    """Collection of workspace Firehose source targets."""

    items: list[FirehoseSourceTargetResponse]
    total: int = Field(..., ge=0)


class FirehoseSourceTargetRunRequest(BaseModel):
    """Fetched source content for an MVP run-once source check."""

    body: str = Field(..., min_length=1)
    content_type: str | None = None
    etag: str | None = None
    fetched_at: str
    last_modified: str | None = None
    status_code: int = Field(..., ge=100, le=599)
    url: str = Field(..., min_length=1)


class FirehoseSourceTargetRunResponse(BaseModel):
    """Run-once source check result."""

    artifacts_created: int = Field(..., ge=0)
    routes_created: int = Field(..., ge=0)
    signals_created: int = Field(..., ge=0)
    unchanged: bool


async def get_firehose_source_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[Any, None]:
    """Yield a per-request Firehose source-target database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _response(target: FirehoseSourceTargetModel) -> FirehoseSourceTargetResponse:
    """Return the API response shape for a stored source target."""
    return FirehoseSourceTargetResponse(
        id=target.id,
        org_id=target.org_id,
        coverage_target_id=target.coverage_target_id,
        label=target.label,
        url=target.url,
        source_kind=target.source_kind,
        source_class=target.source_class,
        places=target.places,
        issues=target.issues,
        priority=target.priority,
        cadence_seconds=target.cadence_seconds,
        enabled=target.enabled,
        safety_policy=target.safety_policy,
        public_route_enabled=target.public_route_enabled,
        origin=target.origin,
        origin_note=target.origin_note,
        last_checked_at=target.last_checked_at,
        last_success_at=target.last_success_at,
        last_error=target.last_error,
        last_http_status=target.last_http_status,
        etag=target.etag,
        last_modified=target.last_modified,
        content_hash=target.content_hash,
        created_by=target.created_by,
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


def _run_response(result: FirehoseRunOnceResult) -> FirehoseSourceTargetRunResponse:
    """Return the API response shape for a run-once result."""
    return FirehoseSourceTargetRunResponse(
        artifacts_created=result.artifacts_created,
        routes_created=result.routes_created,
        signals_created=result.signals_created,
        unchanged=result.unchanged,
    )


async def _require_owned_coverage_target(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    target_id: str,
) -> None:
    target = await CoverageTargetCRUD.get(db, target_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Coverage target not found"
        )


async def _require_owned_source_target(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    source_target_id: str,
) -> FirehoseSourceTargetModel:
    target = await FirehoseSourceTargetCRUD.get_by_id(db, source_target_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firehose source target not found",
        )
    return target


@router.get(
    "/firehose/source-targets",
    response_model=FirehoseSourceTargetCollectionResponse,
    summary="List Firehose source targets",
    operation_id="listFirehoseSourceTargets",
    tags=["firehose"],
)
async def list_firehose_source_targets(
    response: Response,
    coverage_target_id: str | None = Query(None),
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
    db: aiosqlite.Connection = Depends(get_firehose_source_db),
) -> FirehoseSourceTargetCollectionResponse:
    """List Firehose source targets owned by the actor's workspace."""
    assert actor.org_id is not None
    targets = await FirehoseSourceTargetCRUD.list_by_org(db, org_id=actor.org_id)
    if coverage_target_id is not None:
        targets = [target for target in targets if target.coverage_target_id == coverage_target_id]
    apply_no_store_headers(response)
    return FirehoseSourceTargetCollectionResponse(
        items=[_response(target) for target in targets],
        total=len(targets),
    )


@router.post(
    "/firehose/source-targets",
    response_model=FirehoseSourceTargetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Firehose source target",
    operation_id="createFirehoseSourceTarget",
    tags=["firehose"],
)
async def create_firehose_source_target(
    request: FirehoseSourceTargetRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
    db: aiosqlite.Connection = Depends(get_firehose_source_db),
) -> FirehoseSourceTargetResponse:
    """Create or update a workspace Firehose source target."""
    assert actor.org_id is not None
    await _require_owned_coverage_target(
        db,
        org_id=actor.org_id,
        target_id=request.coverage_target_id,
    )
    target = await FirehoseSourceTargetCRUD.create(
        db,
        FirehoseSourceTargetCreate(
            org_id=actor.org_id,
            coverage_target_id=request.coverage_target_id,
            label=request.label,
            url=request.url,
            source_kind=cast("FirehoseSourceKind", request.source_kind),
            source_class=request.source_class,
            places=request.places,
            issues=request.issues,
            created_by=actor.user_id,
            priority=cast("FirehoseSourcePriority", request.priority),
            cadence_seconds=request.cadence_seconds,
            enabled=request.enabled,
            safety_policy=cast("FirehoseSourceSafetyPolicy", request.safety_policy),
            public_route_enabled=request.public_route_enabled,
            origin="api",
            origin_note=request.origin_note,
        ),
    )
    apply_no_store_headers(response)
    return _response(target)


@router.post(
    "/firehose/source-targets/{source_target_id}/runs",
    response_model=FirehoseSourceTargetRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Run Firehose source target once",
    operation_id="runFirehoseSourceTargetOnce",
    tags=["firehose"],
)
async def run_firehose_source_target_once(
    source_target_id: str,
    request: FirehoseSourceTargetRunRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor_permission("firehose", "read")),
    db: aiosqlite.Connection = Depends(get_firehose_source_db),
) -> FirehoseSourceTargetRunResponse:
    """Run one source-target check with caller-supplied fetched content."""
    assert actor.org_id is not None
    await _require_owned_source_target(db, org_id=actor.org_id, source_target_id=source_target_id)
    result = await run_source_target_once(
        db,
        target_id=source_target_id,
        fetched=FirehoseFetchResult(
            body=request.body,
            content_type=request.content_type,
            etag=request.etag,
            fetched_at=request.fetched_at,
            last_modified=request.last_modified,
            status_code=request.status_code,
            url=request.url,
        ),
    )
    apply_no_store_headers(response)
    return _run_response(result)
