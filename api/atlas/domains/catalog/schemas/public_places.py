"""Public catalog place and issue-signal schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .public_common import Address  # noqa: TC001
from .public_entities import EntityResponse  # noqa: TC001

__all__ = [
    "CoverageCount",
    "IssueAreaListResponse",
    "IssueAreaResponse",
    "IssueSignalSummary",
    "IssueSignalsResponse",
    "PlaceCoverageResponse",
    "PlaceGovernmentLinkResponse",
    "PlaceGovernmentResponse",
    "PlaceIdentityResponse",
    "PlacePageContextResponse",
    "PlaceProfileResponse",
    "PlaceRelatedPlaceResponse",
    "PlaceScopeLinkResponse",
    "PlaceSummaryFactResponse",
    "PlaceTypeCount",
]


class IssueAreaResponse(BaseModel):
    """Canonical issue area resource."""

    id: str
    slug: str
    name: str
    description: str
    domain: str
    match_score: float | None = None


class IssueAreaListResponse(BaseModel):
    """Collection response for issue areas."""

    items: list[IssueAreaResponse] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None


class PlaceTypeCount(BaseModel):
    """Entity type count inside an issue signal."""

    type: str
    count: int


class IssueSignalSummary(BaseModel):
    """Summary of support for one issue area in a place."""

    issue_area_id: str
    name: str
    domain: str | None = None
    entity_count: int
    source_count: int
    entity_type_counts: list[PlaceTypeCount] = Field(default_factory=list)
    top_entities: list[EntityResponse] = Field(default_factory=list)


class IssueSignalsResponse(BaseModel):
    """Issue signal response for a place."""

    place: Address
    issues: list[IssueSignalSummary] = Field(default_factory=list)
    resource_uri: str


class CoverageCount(BaseModel):
    """Issue coverage count."""

    issue_area_id: str
    count: int


class PlaceCoverageResponse(BaseModel):
    """Coverage summary for a place."""

    place: Address
    entity_count: int
    issue_counts: list[CoverageCount] = Field(default_factory=list)
    covered_issue_area_ids: list[str] = Field(default_factory=list)
    thin_issue_area_ids: list[str] = Field(default_factory=list)
    missing_issue_area_ids: list[str] = Field(default_factory=list)
    uncovered_domains: list[str] = Field(default_factory=list)
    resource_uri: str


class PlaceIdentityResponse(BaseModel):
    """REST or MCP representation of a place resource."""

    place: Address
    resource_uri: str | None = None


class PlaceScopeLinkResponse(BaseModel):
    """A sibling or parent place link for the place page selector."""

    active: bool
    href: str
    label: str


class PlaceSummaryFactResponse(BaseModel):
    """One compact place fact shown in the page header."""

    attribution: str | None = None
    label: str
    value: str


class PlaceGovernmentLinkResponse(BaseModel):
    """Public government link associated with a place."""

    href: str
    label: str


class PlaceGovernmentResponse(BaseModel):
    """Government or regional public body associated with a place."""

    links: list[PlaceGovernmentLinkResponse] = Field(default_factory=list)
    name: str
    role: str


class PlaceRelatedPlaceResponse(BaseModel):
    """Related local place shown on a place page."""

    accent: Literal["climate", "democracy", "education", "health", "housing", "labor", "neutral"]
    href: str
    kind: Literal[
        "polity",
        "borough",
        "city",
        "county",
        "metro",
        "neighborhood",
        "district",
        "service_area",
        "state",
    ]
    latitude: float | None = None
    longitude: float | None = None
    name: str
    source_dataset: str | None = None
    source_identifier: str | None = None
    source_url: str | None = None
    summary: str


class PlacePageContextResponse(BaseModel):
    """Human-facing place context for public place pages."""

    display: str
    governments: list[PlaceGovernmentResponse] = Field(default_factory=list)
    kind: Literal[
        "polity",
        "borough",
        "city",
        "county",
        "metro",
        "neighborhood",
        "district",
        "service_area",
        "state",
    ]
    name: str
    place_key: str
    places: list[PlaceRelatedPlaceResponse] = Field(default_factory=list)
    resource_uri: str
    scopes: list[PlaceScopeLinkResponse] = Field(default_factory=list)
    source_dataset: str | None = None
    source_identifier: str | None = None
    source_url: str | None = None
    summary_facts: list[PlaceSummaryFactResponse] = Field(default_factory=list)


class PlaceProfileResponse(BaseModel):
    """Structured place profile with flexible data blocks."""

    place: Address
    demographics: dict[str, Any] = Field(default_factory=dict)
    economics: dict[str, Any] = Field(default_factory=dict)
    housing: dict[str, Any] = Field(default_factory=dict)
    education: dict[str, Any] = Field(default_factory=dict)
    health: dict[str, Any] = Field(default_factory=dict)
    provenance: list[dict[str, Any]] = Field(default_factory=list)
    resource_uri: str
