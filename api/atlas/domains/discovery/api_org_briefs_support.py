"""Support helpers for org-scoped private Atlas Brief endpoints."""

from __future__ import annotations

import csv
import io
import re
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings

from .api_org_briefs_models import (
    CSV_COLUMNS,
    OrgBriefConfidenceSummary,
    OrgBriefCreateRequest,
    OrgBriefExportDiscoveryRun,
    OrgBriefExportEntry,
    OrgBriefExportProvenance,
    OrgBriefExportResponse,
    OrgBriefExportSource,
    OrgBriefGap,
    OrgBriefResponse,
    OrgBriefScope,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor
    from atlas.domains.discovery.briefs import OrgBriefModel


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Get a request-scoped database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id.

    Parameters
    ----------
    actor
        Authenticated actor.
    org_id
        Workspace ID from the route path.
    """
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


def _brief_response(brief: OrgBriefModel) -> OrgBriefResponse:
    """Project a brief model into the API response shape.

    Parameters
    ----------
    brief
        Stored brief model.

    Returns
    -------
    OrgBriefResponse
        Response model.
    """
    return OrgBriefResponse(
        id=brief.id,
        org_id=brief.org_id,
        title=brief.title,
        scope=OrgBriefScope.model_validate(brief.scope),
        summary=brief.summary,
        linked_entry_ids=brief.linked_entry_ids,
        linked_source_ids=brief.linked_source_ids,
        linked_discovery_run_ids=brief.linked_discovery_run_ids,
        confidence_summary=OrgBriefConfidenceSummary.model_validate(brief.confidence_summary),
        gaps=[OrgBriefGap.model_validate(gap) for gap in brief.gaps],
        created_by=brief.created_by,
        created_at=brief.created_at,
        updated_at=brief.updated_at,
    )


async def _brief_export_response(
    conn: aiosqlite.Connection,
    brief: OrgBriefModel,
) -> OrgBriefExportResponse:
    """Build the portable JSON export for a private Atlas Brief.

    Parameters
    ----------
    conn
        Database connection.
    brief
        Stored brief model.

    Returns
    -------
    OrgBriefExportResponse
        Export payload with source receipts and linked context.
    """
    entries: list[OrgBriefExportEntry] = []
    for entry_id in brief.linked_entry_ids:
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        if entry is not None:
            entries.append(
                OrgBriefExportEntry(
                    id=entry.id,
                    name=entry.name,
                    type=entry.type,
                    city=entry.city,
                    state=entry.state,
                )
            )

    sources: list[OrgBriefExportSource] = []
    for source_id in brief.linked_source_ids:
        source = await SourceCRUD.get_by_id(conn, source_id)
        if source is not None:
            sources.append(
                OrgBriefExportSource(
                    id=source.id,
                    url=source.url,
                    title=source.title,
                    publication=source.publication,
                    published_date=(
                        source.published_date.isoformat() if source.published_date else None
                    ),
                    type=source.type,
                    ingested_at=source.ingested_at,
                )
            )

    discovery_runs: list[OrgBriefExportDiscoveryRun] = []
    for run_id in brief.linked_discovery_run_ids:
        run = await DiscoveryRunCRUD.get_by_id(conn, run_id)
        if run is not None:
            discovery_runs.append(
                OrgBriefExportDiscoveryRun(
                    id=run.id,
                    location_query=run.location_query,
                    state=run.state,
                    issue_areas=run.issue_areas,
                    research_goal=run.research_goal,
                    status=run.status,
                )
            )

    confidence_summary = OrgBriefConfidenceSummary.model_validate(brief.confidence_summary)
    return OrgBriefExportResponse(
        brief=_brief_response(brief),
        entries=entries,
        sources=sources,
        discovery_runs=discovery_runs,
        provenance=OrgBriefExportProvenance(
            source_count=len(sources),
            entry_count=len(entries),
            discovery_run_count=len(discovery_runs),
            confidence_state=confidence_summary.state,
            review_status=confidence_summary.review_status,
        ),
    )


def _csv_filename_segment(value: str) -> str:
    """Normalize a brief title into a stable CSV filename segment.

    Parameters
    ----------
    value
        Brief title.

    Returns
    -------
    str
        Lowercase filename segment.
    """
    segment = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return segment or "atlas-brief"


def _brief_csv_filename(brief: OrgBriefResponse) -> str:
    """Build the download filename for a CSV brief export.

    Parameters
    ----------
    brief
        Exported brief response.

    Returns
    -------
    str
        Download filename.
    """
    return f"{_csv_filename_segment(brief.title)}-{brief.id}.csv"


def _brief_export_csv(export: OrgBriefExportResponse) -> str:
    """Serialize a private Atlas Brief export as meeting-ready CSV.

    Parameters
    ----------
    export
        JSON export payload.

    Returns
    -------
    str
        CSV text preserving the brief, linked context, gaps, and provenance.
    """
    rows: list[dict[str, str]] = []

    def append_row(row_type: str, values: dict[str, str]) -> None:
        row = dict.fromkeys(CSV_COLUMNS, "")
        row["row_type"] = row_type
        row.update(values)
        rows.append(row)

    brief = export.brief
    append_row(
        "brief",
        {
            "record_id": brief.id,
            "title": brief.title,
            "detail": brief.summary,
            "location": brief.scope.geography,
            "issue_areas": "; ".join(brief.scope.issue_areas),
            "confidence_state": export.provenance.confidence_state,
            "review_status": export.provenance.review_status,
            "source_count": str(export.provenance.source_count),
            "entry_count": str(export.provenance.entry_count),
            "discovery_run_count": str(export.provenance.discovery_run_count),
            "updated_at": brief.updated_at,
        },
    )

    for entry in export.entries:
        append_row(
            "entry",
            {
                "record_id": entry.id,
                "name": entry.name,
                "record_type": entry.type,
                "location": ", ".join(item for item in [entry.city, entry.state] if item),
                "state": entry.state or "",
            },
        )

    for source in export.sources:
        append_row(
            "source",
            {
                "record_id": source.id,
                "title": source.title or "",
                "record_type": source.type,
                "url": source.url,
                "publication": source.publication or "",
                "published_date": source.published_date or "",
                "updated_at": source.ingested_at,
            },
        )

    for run in export.discovery_runs:
        append_row(
            "discovery_run",
            {
                "record_id": run.id,
                "location": run.location_query,
                "state": run.state,
                "issue_areas": "; ".join(run.issue_areas),
                "research_goal": run.research_goal,
                "status": run.status,
            },
        )

    for gap in brief.gaps:
        append_row(
            "gap",
            {
                "title": gap.label,
                "detail": gap.detail,
            },
        )

    append_row(
        "provenance",
        {
            "confidence_state": export.provenance.confidence_state,
            "review_status": export.provenance.review_status,
            "source_count": str(export.provenance.source_count),
            "entry_count": str(export.provenance.entry_count),
            "discovery_run_count": str(export.provenance.discovery_run_count),
        },
    )

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


async def _assert_visible_resource(
    conn: aiosqlite.Connection,
    *,
    resource_id: str,
    resource_type: str,
    org_id: str,
    not_found_detail: str,
) -> None:
    """Reject resource links that do not exist or belong to another workspace.

    Parameters
    ----------
    conn
        Database connection.
    resource_id
        Resource ID to validate.
    resource_type
        Ownership resource type.
    org_id
        Workspace creating the brief.
    not_found_detail
        HTTP detail when the resource is unavailable.
    """
    ownership = await OwnershipCRUD.get_ownership(conn, resource_id, resource_type)
    if ownership is not None and ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail=not_found_detail)


async def _validate_brief_links(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    req: OrgBriefCreateRequest,
) -> None:
    """Validate all linked records before creating a brief.

    Parameters
    ----------
    conn
        Database connection.
    org_id
        Workspace creating the brief.
    req
        Brief create request.
    """
    if not req.linked_entry_ids and not req.linked_source_ids and not req.linked_discovery_run_ids:
        raise HTTPException(
            status_code=400,
            detail="At least one linked entry, source, or discovery run is required.",
        )

    for entry_id in req.linked_entry_ids:
        if await EntryCRUD.get_by_id(conn, entry_id) is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        await _assert_visible_resource(
            conn,
            resource_id=entry_id,
            resource_type="entry",
            org_id=org_id,
            not_found_detail="Entry not found",
        )

    for source_id in req.linked_source_ids:
        if await SourceCRUD.get_by_id(conn, source_id) is None:
            raise HTTPException(status_code=404, detail="Source not found")
        await _assert_visible_resource(
            conn,
            resource_id=source_id,
            resource_type="source",
            org_id=org_id,
            not_found_detail="Source not found",
        )

    for run_id in req.linked_discovery_run_ids:
        if await DiscoveryRunCRUD.get_by_id(conn, run_id) is None:
            raise HTTPException(status_code=404, detail="Discovery run not found")
        await _assert_visible_resource(
            conn,
            resource_id=run_id,
            resource_type="discovery_run",
            org_id=org_id,
            not_found_detail="Discovery run not found",
        )
