"""Coverage target request and response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

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
