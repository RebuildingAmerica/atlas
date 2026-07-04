"""Org-scoped coverage target endpoints."""

from __future__ import annotations

import csv
import io
from collections.abc import AsyncGenerator, Sequence  # noqa: TC003
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watch_events import OrgChangeEventCRUD, OrgCoverageStatusChange
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.discovery.coverage_targets import (
    CoverageTargetCRUD,
    CoverageTargetModel,
    CoverageTargetUpdate,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]

COVERAGE_REPORT_CSV_COLUMNS = [
    "target_id",
    "name",
    "geography",
    "issue_areas",
    "actor_types",
    "source_types",
    "status",
    "status_explanation",
    "review_state",
    "records_found",
    "sources_reviewed",
    "linked_entry_ids",
    "linked_discovery_run_ids",
    "gaps",
    "next_actions",
    "last_run_at",
    "last_reviewed_at",
    "updated_at",
]
COVERAGE_IMPORT_REQUIRED_COLUMNS = frozenset(
    {"actor_types", "geography", "issue_areas", "name", "source_types"}
)
COVERAGE_IMPORT_OPTIONAL_COLUMNS = frozenset(
    {
        "gaps",
        "last_reviewed_at",
        "linked_discovery_run_ids",
        "linked_entry_ids",
        "next_actions",
        "review_state",
    }
)
COVERAGE_IMPORT_COLUMNS = COVERAGE_IMPORT_REQUIRED_COLUMNS | COVERAGE_IMPORT_OPTIONAL_COLUMNS
COVERAGE_REVIEW_STATES = frozenset({"needs_research", "in_review", "ready_for_delivery"})


@dataclass(slots=True)
class ParsedCoverageTargetImportRow:
    """Parsed CSV row ready for link validation and creation."""

    row_number: int
    request: CoverageTargetCreateRequest


class CoverageTargetGap(BaseModel):
    """Coverage gap or unknown that should drive a next action."""

    label: str = Field(..., min_length=1)
    detail: str = Field(..., min_length=1)


class CoverageTargetCreateRequest(BaseModel):
    """Request to create a workspace coverage target."""

    name: str = Field(..., min_length=1)
    geography: str = Field(..., min_length=1)
    issue_areas: list[str] = Field(..., min_length=1)
    actor_types: list[str] = Field(..., min_length=1)
    source_types: list[str] = Field(..., min_length=1)
    linked_discovery_run_ids: list[str] = Field(default_factory=list)
    linked_entry_ids: list[str] = Field(default_factory=list)
    gaps: list[CoverageTargetGap] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    last_reviewed_at: str | None = None
    review_state: Literal["needs_research", "in_review", "ready_for_delivery"] = "needs_research"


class CoverageTargetUpdateRequest(BaseModel):
    """Request to update a workspace coverage target."""

    name: str | None = Field(default=None, min_length=1)
    geography: str | None = Field(default=None, min_length=1)
    issue_areas: list[str] | None = Field(default=None, min_length=1)
    actor_types: list[str] | None = Field(default=None, min_length=1)
    source_types: list[str] | None = Field(default=None, min_length=1)
    linked_discovery_run_ids: list[str] | None = None
    linked_entry_ids: list[str] | None = None
    gaps: list[CoverageTargetGap] | None = None
    next_actions: list[str] | None = None
    last_reviewed_at: str | None = None
    review_state: Literal["needs_research", "in_review", "ready_for_delivery"] | None = None


class CoverageTargetResponse(BaseModel):
    """Workspace coverage target with derived status."""

    id: str
    org_id: str
    name: str
    geography: str
    issue_areas: list[str]
    actor_types: list[str]
    source_types: list[str]
    status: Literal["covered", "thin", "unknown", "stale", "blocked"]
    status_reason: str
    review_state: Literal["needs_research", "in_review", "ready_for_delivery"]
    gaps: list[CoverageTargetGap]
    next_actions: list[str]
    records_found: int = Field(..., ge=0)
    sources_reviewed: int = Field(..., ge=0)
    linked_discovery_run_ids: list[str]
    linked_entry_ids: list[str]
    last_run_at: str | None
    last_reviewed_at: str | None
    created_by: str
    created_at: str
    updated_at: str


class CoverageTargetCollectionResponse(BaseModel):
    """Collection response for workspace coverage targets."""

    items: list[CoverageTargetResponse]
    total: int


class CoverageTargetImportRequest(BaseModel):
    """CSV payload for onboarding coverage targets."""

    csv_text: str = Field(..., min_length=1)


class CoverageTargetImportError(BaseModel):
    """Row-specific coverage import validation error."""

    row: int = Field(..., ge=1)
    field: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)


class CoverageTargetImportResponse(BaseModel):
    """Coverage targets created by an onboarding import."""

    imported: int = Field(..., ge=0)
    created: list[CoverageTargetResponse]


class CoverageTargetDetailSource(BaseModel):
    """Source receipt linked to a coverage target entry."""

    id: str
    url: str
    title: str | None
    publication: str | None
    type: str


class CoverageTargetDetailEntry(BaseModel):
    """Compact linked actor row for coverage target review."""

    id: str
    name: str
    type: str
    city: str | None
    state: str | None
    slug: str | None
    source_count: int = Field(..., ge=0)
    sources: list[CoverageTargetDetailSource]


class CoverageTargetDetailDiscoveryRun(BaseModel):
    """Compact linked research row for coverage target review."""

    id: str
    location_query: str
    state: str
    research_goal: str
    issue_areas: list[str]
    status: str
    entries_confirmed: int = Field(..., ge=0)
    sources_processed: int = Field(..., ge=0)
    started_at: str
    completed_at: str | None


class CoverageTargetDetailResponse(BaseModel):
    """Coverage target detail with the linked evidence needed for action."""

    target: CoverageTargetResponse
    discovery_runs: list[CoverageTargetDetailDiscoveryRun]
    entries: list[CoverageTargetDetailEntry]


class CoverageReportSummary(BaseModel):
    """Workspace coverage report rollup."""

    total_targets: int
    covered: int
    thin: int
    unknown: int
    stale: int
    blocked: int
    needs_work: int
    records_found: int
    sources_reviewed: int
    open_gaps: int
    next_actions: int


class CoverageReportTarget(BaseModel):
    """Coverage target row suitable for customer-facing report exports."""

    id: str
    name: str
    geography: str
    issue_areas: list[str]
    actor_types: list[str]
    source_types: list[str]
    status: Literal["covered", "thin", "unknown", "stale", "blocked"]
    status_explanation: str
    review_state: Literal["needs_research", "in_review", "ready_for_delivery"]
    gaps: list[CoverageTargetGap]
    next_actions: list[str]
    records_found: int = Field(..., ge=0)
    sources_reviewed: int = Field(..., ge=0)
    linked_discovery_run_ids: list[str]
    linked_entry_ids: list[str]
    last_run_at: str | None
    last_reviewed_at: str | None
    updated_at: str


class CoverageReportResponse(BaseModel):
    """Exportable coverage report for one workspace."""

    format: Literal["json"]
    generated_at: str
    org_id: str
    summary: CoverageReportSummary
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


def _target_response(target: CoverageTargetModel) -> CoverageTargetResponse:
    """Convert a coverage target model to its API response."""
    return CoverageTargetResponse(
        id=target.id,
        org_id=target.org_id,
        name=target.name,
        geography=target.geography,
        issue_areas=target.issue_areas,
        actor_types=target.actor_types,
        source_types=target.source_types,
        status=target.status,
        status_reason=target.status_reason,
        review_state=target.review_state,
        gaps=[CoverageTargetGap.model_validate(gap) for gap in target.gaps],
        next_actions=target.next_actions,
        records_found=target.records_found,
        sources_reviewed=target.sources_reviewed,
        linked_discovery_run_ids=target.linked_discovery_run_ids,
        linked_entry_ids=target.linked_entry_ids,
        last_run_at=target.last_run_at,
        last_reviewed_at=target.last_reviewed_at,
        created_by=target.created_by,
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


def _detail_source(source: dict[str, object]) -> CoverageTargetDetailSource:
    """Convert a linked source row into a compact receipt."""
    return CoverageTargetDetailSource(
        id=str(source["id"]),
        url=str(source["url"]),
        title=str(source["title"]) if source.get("title") is not None else None,
        publication=str(source["publication"]) if source.get("publication") is not None else None,
        type=str(source["type"]),
    )


async def _detail_entry(
    db: aiosqlite.Connection,
    entry_id: str,
) -> CoverageTargetDetailEntry | None:
    """Load one linked coverage entry with compact source receipts."""
    entry, sources = await EntryCRUD.get_with_sources(db, entry_id)
    if entry is None:
        return None

    return CoverageTargetDetailEntry(
        id=entry.id,
        name=entry.name,
        type=entry.type,
        city=entry.city,
        state=entry.state,
        slug=entry.slug,
        source_count=len(sources),
        sources=[_detail_source(source) for source in sources],
    )


async def _target_detail_response(
    db: aiosqlite.Connection,
    target: CoverageTargetModel,
) -> CoverageTargetDetailResponse:
    """Build the detail payload that backs target review and follow-up research."""
    discovery_runs = [
        CoverageTargetDetailDiscoveryRun(
            id=run.id,
            location_query=run.location_query,
            state=run.state,
            research_goal=run.research_goal,
            issue_areas=run.issue_areas,
            status=run.status,
            entries_confirmed=run.entries_confirmed,
            sources_processed=run.sources_processed,
            started_at=run.started_at,
            completed_at=run.completed_at,
        )
        for run_id in target.linked_discovery_run_ids
        if (run := await DiscoveryRunCRUD.get_by_id(db, run_id)) is not None
    ]
    linked_entries = [
        entry
        for entry_id in target.linked_entry_ids
        if (entry := await _detail_entry(db, entry_id)) is not None
    ]
    return CoverageTargetDetailResponse(
        target=_target_response(target),
        discovery_runs=discovery_runs,
        entries=linked_entries,
    )


def _status_explanation(target: CoverageTargetModel) -> str:
    """Return plain report language for a derived coverage status."""
    if target.status == "covered":
        return "Current records and sources."
    if target.status == "thin":
        return "Fewer than 3 records or sources."
    if target.status == "stale":
        return "Not reviewed in 90 days."
    if target.status == "blocked":
        return "Latest review failed."
    return "No linked records yet."


def _report_target(target: CoverageTargetModel) -> CoverageReportTarget:
    """Convert a coverage target into a customer-facing report row."""
    return CoverageReportTarget(
        id=target.id,
        name=target.name,
        geography=target.geography,
        issue_areas=target.issue_areas,
        actor_types=target.actor_types,
        source_types=target.source_types,
        status=target.status,
        status_explanation=_status_explanation(target),
        review_state=target.review_state,
        gaps=[CoverageTargetGap.model_validate(gap) for gap in target.gaps],
        next_actions=target.next_actions,
        records_found=target.records_found,
        sources_reviewed=target.sources_reviewed,
        linked_discovery_run_ids=target.linked_discovery_run_ids,
        linked_entry_ids=target.linked_entry_ids,
        last_run_at=target.last_run_at,
        last_reviewed_at=target.last_reviewed_at,
        updated_at=target.updated_at,
    )


def build_coverage_report_response(
    *,
    org_id: str,
    targets: list[CoverageTargetModel],
) -> CoverageReportResponse:
    """Build a customer-facing JSON coverage report."""
    status_counts = {
        "blocked": 0,
        "covered": 0,
        "stale": 0,
        "thin": 0,
        "unknown": 0,
    }
    for target in targets:
        status_counts[target.status] += 1

    return CoverageReportResponse(
        format="json",
        generated_at=datetime.now(UTC).isoformat(),
        org_id=org_id,
        summary=CoverageReportSummary(
            total_targets=len(targets),
            covered=status_counts["covered"],
            thin=status_counts["thin"],
            unknown=status_counts["unknown"],
            stale=status_counts["stale"],
            blocked=status_counts["blocked"],
            needs_work=len(targets) - status_counts["covered"],
            records_found=sum(target.records_found for target in targets),
            sources_reviewed=sum(target.sources_reviewed for target in targets),
            open_gaps=sum(len(target.gaps) for target in targets),
            next_actions=sum(len(target.next_actions) for target in targets),
        ),
        targets=[_report_target(target) for target in targets],
    )


def _join_values(values: list[str]) -> str:
    """Return a semicolon-delimited CSV cell."""
    return ";".join(values)


def _gap_rows(gaps: list[CoverageTargetGap]) -> str:
    """Return compact gap labels and details for CSV export."""
    return ";".join(f"{gap.label}: {gap.detail}" for gap in gaps)


def _coverage_report_csv(report: CoverageReportResponse) -> str:
    """Serialize a coverage report as CSV rows."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COVERAGE_REPORT_CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for target in report.targets:
        writer.writerow(
            {
                "target_id": target.id,
                "name": target.name,
                "geography": target.geography,
                "issue_areas": _join_values(target.issue_areas),
                "actor_types": _join_values(target.actor_types),
                "source_types": _join_values(target.source_types),
                "status": target.status,
                "status_explanation": target.status_explanation,
                "review_state": target.review_state,
                "records_found": target.records_found,
                "sources_reviewed": target.sources_reviewed,
                "linked_entry_ids": _join_values(target.linked_entry_ids),
                "linked_discovery_run_ids": _join_values(target.linked_discovery_run_ids),
                "gaps": _gap_rows(target.gaps),
                "next_actions": _join_values(target.next_actions),
                "last_run_at": target.last_run_at or "",
                "last_reviewed_at": target.last_reviewed_at or "",
                "updated_at": target.updated_at,
            }
        )
    return buffer.getvalue()


async def _validate_target_fields(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    issue_areas: list[str],
    linked_discovery_run_ids: list[str],
    linked_entry_ids: list[str],
) -> None:
    """Validate scope and links before storing a coverage target."""
    for issue_area in issue_areas:
        if issue_area not in ALL_ISSUE_SLUGS:
            raise HTTPException(status_code=400, detail=f"Invalid issue area: {issue_area}")

    for run_id in linked_discovery_run_ids:
        ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
        if ownership is None or ownership.org_id != org_id:
            raise HTTPException(status_code=404, detail="Discovery run not found")

    for entry_id in linked_entry_ids:
        entry = await EntryCRUD.get_by_id(db, entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")


async def _validate_target_links(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    req: CoverageTargetCreateRequest,
) -> None:
    """Validate scope and links before creating a coverage target."""
    await _validate_target_fields(
        db,
        org_id=org_id,
        issue_areas=req.issue_areas,
        linked_discovery_run_ids=req.linked_discovery_run_ids,
        linked_entry_ids=req.linked_entry_ids,
    )


def _normalize_import_header(value: str) -> str:
    """Normalize a CSV header from a customer onboarding spreadsheet."""
    return value.strip().removeprefix("\ufeff")


def _split_import_cell(value: str | None) -> list[str]:
    """Split semicolon-delimited cell values while dropping blank fragments."""
    if value is None:
        return []
    return [item.strip() for item in value.split(";") if item.strip()]


def _import_cell(row: dict[str, str | None], field: str) -> str:
    """Return a normalized import cell."""
    return (row.get(field) or "").strip()


def _parse_import_review_state(
    value: str,
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> Literal["needs_research", "in_review", "ready_for_delivery"]:
    """Return a validated coverage review state for an import row."""
    if not value or value == "needs_research":
        return "needs_research"
    if value == "in_review":
        return "in_review"
    if value == "ready_for_delivery":
        return "ready_for_delivery"

    errors.append(
        CoverageTargetImportError(
            row=row_number,
            field="review_state",
            message="Review state must be needs_research, in_review, or ready_for_delivery.",
        )
    )
    return "needs_research"


def _parse_import_gaps(
    value: str,
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> list[CoverageTargetGap]:
    """Parse semicolon-delimited gap labels and details from one CSV cell."""
    gaps: list[CoverageTargetGap] = []
    for gap in _split_import_cell(value):
        label, separator, detail = gap.partition(":")
        if not separator or not label.strip() or not detail.strip():
            errors.append(
                CoverageTargetImportError(
                    row=row_number,
                    field="gaps",
                    message="Gaps must use 'Label: detail' entries separated by semicolons.",
                )
            )
            continue
        gaps.append(CoverageTargetGap(label=label.strip(), detail=detail.strip()))
    return gaps


def _validate_import_headers(
    fieldnames: Sequence[str] | None,
) -> tuple[dict[str, str], list[CoverageTargetImportError]]:
    """Validate and map CSV headers to their normalized field names."""
    if fieldnames is None:
        return {}, [
            CoverageTargetImportError(
                row=1,
                field="csv",
                message="CSV header row is required.",
            )
        ]

    header_map: dict[str, str] = {}
    errors: list[CoverageTargetImportError] = []
    normalized_headers = [_normalize_import_header(fieldname) for fieldname in fieldnames]
    for raw_header, normalized in zip(fieldnames, normalized_headers, strict=False):
        if not normalized:
            errors.append(
                CoverageTargetImportError(
                    row=1,
                    field="csv",
                    message="CSV column names cannot be blank.",
                )
            )
            continue
        if normalized not in COVERAGE_IMPORT_COLUMNS:
            errors.append(
                CoverageTargetImportError(
                    row=1,
                    field=normalized,
                    message="Unknown coverage import column.",
                )
            )
            continue
        if normalized in header_map.values():
            errors.append(
                CoverageTargetImportError(
                    row=1,
                    field=normalized,
                    message="Duplicate coverage import column.",
                )
            )
            continue
        header_map[raw_header] = normalized

    errors.extend(
        CoverageTargetImportError(
            row=1,
            field=required_column,
            message="Missing required coverage import column.",
        )
        for required_column in sorted(COVERAGE_IMPORT_REQUIRED_COLUMNS)
        if required_column not in normalized_headers
    )

    return header_map, errors


def _required_import_row_errors(
    row: dict[str, str | None],
    *,
    row_number: int,
) -> list[CoverageTargetImportError]:
    """Return missing-value errors for one import row."""
    return [
        CoverageTargetImportError(
            row=row_number,
            field=required_field,
            message="Required value is missing.",
        )
        for required_field in sorted(COVERAGE_IMPORT_REQUIRED_COLUMNS)
        if not _import_cell(row, required_field)
    ]


def _issue_area_import_row_errors(
    issue_areas: list[str],
    *,
    row_number: int,
) -> list[CoverageTargetImportError]:
    """Return invalid issue area errors for one import row."""
    return [
        CoverageTargetImportError(
            row=row_number,
            field="issue_areas",
            message=f"Invalid issue area: {issue_area}",
        )
        for issue_area in issue_areas
        if issue_area not in ALL_ISSUE_SLUGS
    ]


def _normalized_import_row(
    raw_row: dict[str | None, str | list[str] | None],
    header_map: dict[str, str],
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> dict[str, str | None]:
    """Normalize one CSV row to known coverage import field names."""
    if None in raw_row:
        errors.append(
            CoverageTargetImportError(
                row=row_number,
                field="csv",
                message="Row has more values than the header row.",
            )
        )
    normalized: dict[str, str | None] = {}
    for raw_header, value in raw_row.items():
        if raw_header is None:
            continue
        normalized_header = header_map.get(raw_header)
        if normalized_header is None:
            continue
        normalized[normalized_header] = value if isinstance(value, str) else None
    return normalized


def _parse_import_row(
    row: dict[str, str | None],
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> ParsedCoverageTargetImportRow | None:
    """Parse one normalized CSV row into a coverage target request."""
    if all(not (value or "").strip() for value in row.values()):
        return None

    row_error_count = len(errors)
    errors.extend(_required_import_row_errors(row, row_number=row_number))

    issue_areas = _split_import_cell(_import_cell(row, "issue_areas"))
    errors.extend(_issue_area_import_row_errors(issue_areas, row_number=row_number))

    actor_types = _split_import_cell(_import_cell(row, "actor_types"))
    source_types = _split_import_cell(_import_cell(row, "source_types"))
    if len(errors) > row_error_count or not issue_areas or not actor_types or not source_types:
        return None

    review_state = _parse_import_review_state(
        _import_cell(row, "review_state"),
        row_number=row_number,
        errors=errors,
    )
    gaps = _parse_import_gaps(_import_cell(row, "gaps"), row_number=row_number, errors=errors)
    if len(errors) > row_error_count:
        return None

    return ParsedCoverageTargetImportRow(
        row_number=row_number,
        request=CoverageTargetCreateRequest(
            name=_import_cell(row, "name"),
            geography=_import_cell(row, "geography"),
            issue_areas=issue_areas,
            actor_types=actor_types,
            source_types=source_types,
            linked_discovery_run_ids=_split_import_cell(
                _import_cell(row, "linked_discovery_run_ids")
            ),
            linked_entry_ids=_split_import_cell(_import_cell(row, "linked_entry_ids")),
            gaps=gaps,
            next_actions=_split_import_cell(_import_cell(row, "next_actions")),
            last_reviewed_at=_import_cell(row, "last_reviewed_at") or None,
            review_state=review_state,
        ),
    )


def _parse_coverage_target_import_csv(
    csv_text: str,
) -> tuple[list[ParsedCoverageTargetImportRow], list[CoverageTargetImportError]]:
    """Parse a CSV payload into coverage target create requests."""
    reader = csv.DictReader(io.StringIO(csv_text), skipinitialspace=True)
    header_map, errors = _validate_import_headers(reader.fieldnames)
    if errors:
        return [], errors

    parsed_rows: list[ParsedCoverageTargetImportRow] = []
    try:
        for row_number, raw_row in enumerate(reader, start=2):
            normalized = _normalized_import_row(
                raw_row,
                header_map,
                row_number=row_number,
                errors=errors,
            )
            parsed = _parse_import_row(normalized, row_number=row_number, errors=errors)
            if parsed is not None:
                parsed_rows.append(parsed)
    except csv.Error as exc:
        errors.append(
            CoverageTargetImportError(row=1, field="csv", message=f"CSV could not be parsed: {exc}")
        )

    if not parsed_rows and not errors:
        errors.append(
            CoverageTargetImportError(
                row=1,
                field="csv",
                message="At least one coverage target row is required.",
            )
        )

    return parsed_rows, errors


async def _validate_import_target_links(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    parsed_rows: list[ParsedCoverageTargetImportRow],
) -> list[CoverageTargetImportError]:
    """Validate imported link references before any target is created."""
    errors: list[CoverageTargetImportError] = []
    for parsed_row in parsed_rows:
        req = parsed_row.request
        for run_id in req.linked_discovery_run_ids:
            ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
            if ownership is None or ownership.org_id != org_id:
                errors.append(
                    CoverageTargetImportError(
                        row=parsed_row.row_number,
                        field="linked_discovery_run_ids",
                        message=f"Discovery run not found: {run_id}",
                    )
                )

        for entry_id in req.linked_entry_ids:
            entry = await EntryCRUD.get_by_id(db, entry_id)
            if entry is None:
                errors.append(
                    CoverageTargetImportError(
                        row=parsed_row.row_number,
                        field="linked_entry_ids",
                        message=f"Entry not found: {entry_id}",
                    )
                )
    return errors


def _coverage_import_error_detail(
    errors: list[CoverageTargetImportError],
) -> dict[str, object]:
    """Return a stable error shape for coverage target import failures."""
    return {
        "message": "Coverage import failed.",
        "errors": [error.model_dump() for error in errors],
    }


def _target_update_input(
    target: CoverageTargetModel,
    req: CoverageTargetUpdateRequest,
) -> CoverageTargetUpdate:
    """Merge a partial update request with the current coverage target."""
    fields = req.model_fields_set
    gaps = (
        [gap.model_dump() for gap in req.gaps]
        if "gaps" in fields and req.gaps is not None
        else target.gaps
    )
    return CoverageTargetUpdate(
        name=req.name if req.name is not None else target.name,
        geography=req.geography if req.geography is not None else target.geography,
        issue_areas=req.issue_areas if req.issue_areas is not None else target.issue_areas,
        actor_types=req.actor_types if req.actor_types is not None else target.actor_types,
        source_types=req.source_types if req.source_types is not None else target.source_types,
        gaps=gaps,
        next_actions=req.next_actions if req.next_actions is not None else target.next_actions,
        linked_discovery_run_ids=(
            req.linked_discovery_run_ids
            if req.linked_discovery_run_ids is not None
            else target.linked_discovery_run_ids
        ),
        linked_entry_ids=(
            req.linked_entry_ids if req.linked_entry_ids is not None else target.linked_entry_ids
        ),
        last_reviewed_at=(
            req.last_reviewed_at if "last_reviewed_at" in fields else target.last_reviewed_at
        ),
        review_state=req.review_state if req.review_state is not None else target.review_state,
    )


@router.get(
    "/export",
    response_model=CoverageReportResponse,
    summary="Export workspace coverage targets",
    operation_id="exportOrgCoverageTargets",
    tags=["org-coverage-targets"],
)
async def export_org_coverage_targets(
    org_id: str,
    response: Response,
    export_format: Literal["json", "csv"] = Query("json", alias="format"),
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("workspace.export")),
) -> CoverageReportResponse | Response:
    """Export coverage targets as JSON or CSV report rows."""
    _verify_org_access(actor, org_id)
    targets = await CoverageTargetCRUD.list_by_org(db, org_id)
    report = build_coverage_report_response(org_id=org_id, targets=targets)
    if export_format == "csv":
        csv_response = Response(
            content=_coverage_report_csv(report),
            media_type="text/csv; charset=utf-8",
        )
        csv_response.headers["content-disposition"] = (
            f'attachment; filename="atlas-coverage-{org_id}.csv"'
        )
        apply_no_store_headers(csv_response)
        return csv_response

    apply_no_store_headers(response)
    return report


@router.post(
    "/import",
    response_model=CoverageTargetImportResponse,
    status_code=201,
    summary="Import workspace coverage targets",
    operation_id="importOrgCoverageTargets",
    tags=["org-coverage-targets"],
)
async def import_org_coverage_targets(
    org_id: str,
    req: CoverageTargetImportRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
) -> CoverageTargetImportResponse:
    """Import coverage targets from a customer onboarding CSV."""
    _verify_org_access(actor, org_id)
    parsed_rows, errors = _parse_coverage_target_import_csv(req.csv_text)
    errors.extend(await _validate_import_target_links(db, org_id=org_id, parsed_rows=parsed_rows))
    if errors:
        raise HTTPException(status_code=400, detail=_coverage_import_error_detail(errors))

    created: list[CoverageTargetResponse] = []
    for parsed_row in parsed_rows:
        target_request = parsed_row.request
        target = await CoverageTargetCRUD.create(
            db,
            org_id=org_id,
            name=target_request.name,
            geography=target_request.geography,
            issue_areas=target_request.issue_areas,
            actor_types=target_request.actor_types,
            source_types=target_request.source_types,
            gaps=[gap.model_dump() for gap in target_request.gaps],
            next_actions=target_request.next_actions,
            linked_discovery_run_ids=target_request.linked_discovery_run_ids,
            linked_entry_ids=target_request.linked_entry_ids,
            created_by=actor.user_id,
            last_reviewed_at=target_request.last_reviewed_at,
            review_state=target_request.review_state,
        )
        created.append(_target_response(target))

    apply_no_store_headers(response)
    return CoverageTargetImportResponse(imported=len(created), created=created)


@router.get(
    "/{target_id}",
    response_model=CoverageTargetDetailResponse,
    summary="Get workspace coverage target detail",
    operation_id="getOrgCoverageTarget",
    tags=["org-coverage-targets"],
)
async def get_org_coverage_target(
    org_id: str,
    target_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> CoverageTargetDetailResponse:
    """Return a workspace coverage target with linked evidence for review."""
    _verify_org_access(actor, org_id)
    target = await CoverageTargetCRUD.get(db, target_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(status_code=404, detail="Coverage target not found")

    apply_no_store_headers(response)
    return await _target_detail_response(db, target)


@router.patch(
    "/{target_id}",
    response_model=CoverageTargetResponse,
    summary="Update a workspace coverage target",
    operation_id="updateOrgCoverageTarget",
    tags=["org-coverage-targets"],
)
async def update_org_coverage_target(  # noqa: PLR0913
    org_id: str,
    target_id: str,
    req: CoverageTargetUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
) -> CoverageTargetResponse:
    """Update a coverage target and notify watched workspaces of status changes."""
    _verify_org_access(actor, org_id)
    if not req.model_fields_set:
        raise HTTPException(
            status_code=400, detail="At least one coverage target field is required."
        )

    target = await CoverageTargetCRUD.get(db, target_id)
    if target is None or target.org_id != org_id:
        raise HTTPException(status_code=404, detail="Coverage target not found")

    update_input = _target_update_input(target, req)
    await _validate_target_fields(
        db,
        org_id=org_id,
        issue_areas=update_input.issue_areas,
        linked_discovery_run_ids=update_input.linked_discovery_run_ids,
        linked_entry_ids=update_input.linked_entry_ids,
    )
    updated = await CoverageTargetCRUD.update(db, target_id, update_input)
    if updated is None:
        raise HTTPException(status_code=404, detail="Coverage target not found")

    await OrgChangeEventCRUD.record_coverage_status_event(
        db,
        OrgCoverageStatusChange(
            org_id=org_id,
            target_id=target_id,
            target_name=updated.name,
            previous_status=target.status,
            new_status=updated.status,
        ),
    )
    if target.status != "covered" and updated.status == "covered":
        await OrgUsageEventCRUD.record(
            db,
            OrgUsageEventRecord(
                org_id=org_id,
                actor_id=actor.user_id,
                event_type="coverage_gap_closed",
                resource_type="coverage_target",
                resource_id=target_id,
            ),
        )
    apply_no_store_headers(response)
    return _target_response(updated)


@router.get(
    "",
    response_model=CoverageTargetCollectionResponse,
    summary="List workspace coverage targets",
    operation_id="listOrgCoverageTargets",
    tags=["org-coverage-targets"],
)
async def list_org_coverage_targets(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> CoverageTargetCollectionResponse:
    """List coverage targets owned by a workspace."""
    _verify_org_access(actor, org_id)
    targets = await CoverageTargetCRUD.list_by_org(db, org_id)
    apply_no_store_headers(response)
    return CoverageTargetCollectionResponse(
        items=[_target_response(target) for target in targets],
        total=len(targets),
    )


@router.post(
    "",
    response_model=CoverageTargetResponse,
    status_code=201,
    summary="Create a workspace coverage target",
    operation_id="createOrgCoverageTarget",
    tags=["org-coverage-targets"],
)
async def create_org_coverage_target(
    org_id: str,
    req: CoverageTargetCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("research.run")),
) -> CoverageTargetResponse:
    """Create a coverage target with status derived from linked evidence."""
    _verify_org_access(actor, org_id)
    await _validate_target_links(db, org_id=org_id, req=req)
    target = await CoverageTargetCRUD.create(
        db,
        org_id=org_id,
        name=req.name,
        geography=req.geography,
        issue_areas=req.issue_areas,
        actor_types=req.actor_types,
        source_types=req.source_types,
        gaps=[gap.model_dump() for gap in req.gaps],
        next_actions=req.next_actions,
        linked_discovery_run_ids=req.linked_discovery_run_ids,
        linked_entry_ids=req.linked_entry_ids,
        created_by=actor.user_id,
        last_reviewed_at=req.last_reviewed_at,
        review_state=req.review_state,
    )
    apply_no_store_headers(response)
    return _target_response(target)
