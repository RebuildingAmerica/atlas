"""Discovery run + job creation, shared by the REST route and the MCP write tool.

Kept separate from ``api.py`` so this has no dependency on ``atlas.platform.http``
(which itself imports ``atlas.domains.discovery.api`` for its router) — importing
``create_discovery_run_records`` from ``api.py`` directly created a circular
import whenever something imported ``atlas.platform.mcp`` before
``atlas.platform.http`` had already been fully loaded.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException

from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
    run_discovery_pipeline_for_run,
)
from atlas.models import DiscoveryRunCRUD

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.discovery.models import DiscoveryRunModel
    from atlas.platform.config import Settings
    from atlas.schemas import DiscoveryRunStartRequest

__all__ = ["create_discovery_run_records", "validate_issue_areas"]


def validate_issue_areas(issue_areas: list[str]) -> None:
    """Raise when any requested issue area falls outside the Atlas taxonomy."""
    invalid_issue_areas = [
        issue_area for issue_area in issue_areas if issue_area not in ALL_ISSUE_SLUGS
    ]
    if invalid_issue_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue area(s): {', '.join(invalid_issue_areas)}",
        )


async def create_discovery_run_records(
    db: aiosqlite.Connection,
    *,
    req: DiscoveryRunStartRequest,
    settings: Settings,
    idempotency_key: str | None = None,
) -> DiscoveryRunModel:
    """Create a discovery run and its execution job, or run it inline.

    Shared by the REST route and the MCP ``start_discovery_run`` tool so both
    callers create runs and jobs through the exact same path. ``idempotency_key``
    is only honored for the non-inline job; inline runs execute synchronously
    and have no job to dedupe against.

    Raises
    ------
    HTTPException
        400 for an invalid issue area or a ``direct_url`` run missing
        ``direct_urls``; 500 if the run cannot be reloaded after creation.
    """
    validate_issue_areas(req.issue_areas)
    if req.execution_mode == "direct_url" and not req.direct_urls:
        raise HTTPException(status_code=400, detail="Direct URL discovery requires direct_urls")

    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query=req.location_query,
        state=req.state,
        issue_areas=req.issue_areas,
        research_goal=req.research_goal,
    )

    run = await DiscoveryRunCRUD.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=500, detail="Failed to create discovery run")

    if settings.discovery_inline:
        pipeline_job = DiscoveryPipelineJob(
            run_id=run_id,
            location_query=req.location_query,
            state=req.state,
            issue_areas=req.issue_areas,
            research_goal=req.research_goal,
        )
        pipeline_credentials = DiscoveryPipelineCredentials(
            search_api_key=settings.search_api_key,
            anthropic_api_key=settings.anthropic_api_key,
        )
        await run_discovery_pipeline_for_run(
            database_url=settings.database_url,
            job=pipeline_job,
            credentials=pipeline_credentials,
            settings=settings,
        )
        run = await DiscoveryRunCRUD.get_by_id(db, run_id)
        if not run:
            raise HTTPException(status_code=500, detail="Failed to refresh discovery run")
    else:
        input_payload: dict[str, object] = {}
        if req.execution_mode == "direct_url":
            input_payload = {"direct_urls": req.direct_urls}
        await DiscoveryJobCRUD.create(
            db,
            run_id=run_id,
            idempotency_key=idempotency_key,
            job_input=DiscoveryJobInput(
                execution_mode=req.execution_mode,
                payload=input_payload,
            ),
        )

    return run
