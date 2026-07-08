"""Models for org-scoped private Atlas Brief endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CSV_COLUMNS = [
    "row_type",
    "record_id",
    "title",
    "name",
    "record_type",
    "detail",
    "url",
    "publication",
    "published_date",
    "location",
    "state",
    "issue_areas",
    "research_goal",
    "status",
    "confidence_state",
    "review_status",
    "source_count",
    "entry_count",
    "discovery_run_count",
    "updated_at",
]


class OrgBriefScope(BaseModel):
    """Research scope represented by an Atlas Brief."""

    geography: str = Field(..., min_length=1)
    issue_areas: list[str] = Field(..., min_length=1)
    actor_types: list[str] = Field(..., min_length=1)
    source_types: list[str] = Field(..., min_length=1)


class OrgBriefConfidenceSummary(BaseModel):
    """Trust summary for a private Atlas Brief."""

    state: Literal["corroborated", "partial", "unverified"]
    source_count: int = Field(..., ge=0)
    review_status: str = Field(..., min_length=1)


class OrgBriefGap(BaseModel):
    """Known gap or unknown represented in an Atlas Brief."""

    label: str = Field(..., min_length=1)
    detail: str = Field(..., min_length=1)


class OrgBriefCreateRequest(BaseModel):
    """Request to create a private Atlas Brief artifact."""

    title: str = Field(..., min_length=1)
    scope: OrgBriefScope
    summary: str = Field(..., min_length=1)
    linked_entry_ids: list[str]
    linked_source_ids: list[str]
    linked_discovery_run_ids: list[str]
    confidence_summary: OrgBriefConfidenceSummary
    gaps: list[OrgBriefGap]


class OrgBriefUpdateRequest(BaseModel):
    """Request to update editable private Atlas Brief memo fields."""

    title: str | None = Field(None, min_length=1)
    summary: str | None = Field(None, min_length=1)
    confidence_summary: OrgBriefConfidenceSummary | None = None
    gaps: list[OrgBriefGap] | None = None


class OrgBriefResponse(BaseModel):
    """Private Atlas Brief artifact response."""

    id: str
    org_id: str
    title: str
    scope: OrgBriefScope
    summary: str
    linked_entry_ids: list[str]
    linked_source_ids: list[str]
    linked_discovery_run_ids: list[str]
    confidence_summary: OrgBriefConfidenceSummary
    gaps: list[OrgBriefGap]
    created_by: str
    created_at: str
    updated_at: str


class OrgBriefCollectionResponse(BaseModel):
    """Collection response for private Atlas Brief artifacts."""

    items: list[OrgBriefResponse]
    total: int


class OrgBriefExportEntry(BaseModel):
    """Linked actor context included in a brief export."""

    id: str
    name: str
    type: str
    city: str | None
    state: str | None


class OrgBriefExportSource(BaseModel):
    """Source receipt included in a brief export."""

    id: str
    url: str
    title: str | None
    publication: str | None
    published_date: str | None
    type: str
    ingested_at: str


class OrgBriefExportDiscoveryRun(BaseModel):
    """Discovery run context included in a brief export."""

    id: str
    location_query: str
    state: str
    issue_areas: list[str]
    research_goal: str
    status: str


class OrgBriefExportProvenance(BaseModel):
    """Summary of provenance carried by a brief export."""

    source_count: int
    entry_count: int
    discovery_run_count: int
    confidence_state: Literal["corroborated", "partial", "unverified"]
    review_status: str


class OrgBriefExportResponse(BaseModel):
    """JSON export for a private Atlas Brief with provenance."""

    format: Literal["json"] = "json"
    brief: OrgBriefResponse
    entries: list[OrgBriefExportEntry]
    sources: list[OrgBriefExportSource]
    discovery_runs: list[OrgBriefExportDiscoveryRun]
    provenance: OrgBriefExportProvenance
