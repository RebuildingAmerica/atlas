"""Org-scoped coverage underwriting report endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.api_org_coverage import (
    CoverageReportSummary,
    CoverageReportTarget,
    build_coverage_report_response,
)
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]

DATA_BOUNDARY_STATEMENT = (
    "Underwriting improves public coverage, but public records remain public "
    "and private workspace notes are excluded."
)


class CoverageReportPublicImpact(BaseModel):
    """Public-good impact counts from coverage work and usage signals."""

    coverage_gaps_closed: int = Field(..., ge=0)
    public_records_improved: int = Field(..., ge=0)
    records_found: int = Field(..., ge=0)
    sources_reviewed: int = Field(..., ge=0)


class CoverageReportDataBoundary(BaseModel):
    """Boundary between public civic records and private workspace material."""

    exclusive_public_data_access: bool
    private_workspace_notes_included: bool
    statement: str


class CoverageUnderwritingReportResponse(BaseModel):
    """Underwriting report showing public coverage outcomes without private notes."""

    generated_at: str
    org_id: str
    summary: CoverageReportSummary
    public_impact: CoverageReportPublicImpact
    data_boundary: CoverageReportDataBoundary
    targets: list[CoverageReportTarget]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


def _event_count(event_counts: dict[str, int], event_type: str) -> int:
    """Return the count for one usage event type."""
    return event_counts.get(event_type, 0)


def _public_impact(
    *,
    event_counts: dict[str, int],
    summary: CoverageReportSummary,
) -> CoverageReportPublicImpact:
    """Build public impact totals from usage events and coverage status."""
    return CoverageReportPublicImpact(
        coverage_gaps_closed=_event_count(event_counts, "coverage_gap_closed"),
        public_records_improved=_event_count(event_counts, "public_record_improved"),
        records_found=summary.records_found,
        sources_reviewed=summary.sources_reviewed,
    )


def _data_boundary() -> CoverageReportDataBoundary:
    """Return the report boundary that protects public trust and private workspace data."""
    return CoverageReportDataBoundary(
        exclusive_public_data_access=False,
        private_workspace_notes_included=False,
        statement=DATA_BOUNDARY_STATEMENT,
    )


@router.get(
    "",
    response_model=CoverageUnderwritingReportResponse,
    summary="Get coverage underwriting report",
    operation_id="getOrgCoverageUnderwritingReport",
    tags=["org-coverage-reports"],
)
async def get_org_coverage_underwriting_report(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("coverage.underwriting")),
) -> CoverageUnderwritingReportResponse:
    """Return a funder-facing report of public coverage outcomes."""
    _verify_org_access(actor, org_id)
    targets = await CoverageTargetCRUD.list_by_org(db, org_id)
    coverage_report = build_coverage_report_response(org_id=org_id, targets=targets)
    event_counts = await OrgUsageEventCRUD.count_by_type(db, org_id=org_id)
    apply_no_store_headers(response)
    return CoverageUnderwritingReportResponse(
        generated_at=coverage_report.generated_at,
        org_id=org_id,
        summary=coverage_report.summary,
        public_impact=_public_impact(
            event_counts=event_counts,
            summary=coverage_report.summary,
        ),
        data_boundary=_data_boundary(),
        targets=coverage_report.targets,
    )
