"""Canonical public Pydantic models shared by REST and MCP."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

__all__ = [
    "Address",
    "ContactInfo",
    "CoverageCount",
    "DiscoveryRunCollectionResponse",
    "DomainDetailResponse",
    "DomainListResponse",
    "DomainResponse",
    "EntityCollectionResponse",
    "EntityDetailResponse",
    "EntityFlagCreateRequest",
    "EntityFlagListResponse",
    "EntityRelationship",
    "EntityRelationshipItem",
    "EntityRelationshipsResponse",
    "EntityResponse",
    "EntitySourcesResponse",
    "FacetOption",
    "FlagResponse",
    "FlagSummary",
    "FreshnessInfo",
    "IssueAreaListResponse",
    "IssueAreaResponse",
    "IssueSignalSummary",
    "IssueSignalsResponse",
    "PlaceCoverageResponse",
    "PlaceIdentityResponse",
    "PlaceProfileResponse",
    "PlaceTypeCount",
    "SourceCollectionResponse",
    "SourceFlagCreateRequest",
    "SourceFlagListResponse",
    "SourceResponse",
]


class Address(BaseModel):
    """Canonical address and place metadata."""

    city: str | None = None
    state: str | None = None
    region: str | None = None
    full_address: str | None = None
    geo_specificity: str | None = None
    display: str | None = None


class ContactInfo(BaseModel):
    """Canonical public contact surface."""

    website: str | None = None
    email: str | None = None
    phone: str | None = None
    social_media: dict[str, str] | None = None


class FreshnessInfo(BaseModel):
    """Signals describing how current a record is."""

    updated_at: str | None = None
    created_at: str | None = None
    last_seen: str | None = None
    last_verified: str | None = None
    latest_source_date: str | None = None
    published_date: str | None = None
    ingested_at: str | None = None
    staleness_status: str
    staleness_reason: str


class FlagSummary(BaseModel):
    """Aggregate flag state for a target."""

    flag_count: int = 0
    open_flag_count: int = 0
    latest_flagged_at: str | None = None
    has_open_flags: bool = False


class FlagResponse(BaseModel):
    """Flag resource for an entity or source."""

    id: str
    target_type: str
    target_id: str
    reason: str
    note: str | None = None
    status: str
    created_at: str


class EntityFlagCreateRequest(BaseModel):
    """Anonymous flag submission for an entity."""

    entity_id: str
    reason: str
    note: str | None = None


class SourceFlagCreateRequest(BaseModel):
    """Anonymous flag submission for a source."""

    source_id: str
    reason: str
    note: str | None = None


class EntityFlagListResponse(BaseModel):
    """Entity flags collection."""

    items: list[FlagResponse] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None


class SourceFlagListResponse(BaseModel):
    """Source flags collection."""

    items: list[FlagResponse] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None


class FacetOption(BaseModel):
    """A single filter option with result count."""

    value: str
    count: int


class EntityResponse(BaseModel):
    """Canonical public entity shape."""

    id: str
    type: str
    name: str
    description: str
    address: Address
    contact: ContactInfo
    affiliated_org_id: str | None = None
    active: bool
    verified: bool
    issue_area_ids: list[str] = Field(default_factory=list)
    source_types: list[str] = Field(default_factory=list)
    source_count: int = 0
    freshness: FreshnessInfo
    flag_summary: FlagSummary = Field(default_factory=FlagSummary)
    slug: str | None = Field(None, description="Human-readable URL slug (e.g., jane-doe-a3f2).")
    created_at: str
    updated_at: str
    resource_uri: str


class SourceResponse(BaseModel):
    """Canonical public source shape."""

    id: str
    url: str
    title: str | None = None
    publication: str | None = None
    type: str | None = None
    extraction_method: str | None = None
    extraction_context: str | None = None
    linked_entity_ids: list[str] = Field(default_factory=list)
    freshness: FreshnessInfo
    flag_summary: FlagSummary = Field(default_factory=FlagSummary)
    resource_uri: str


class EntityDetailResponse(EntityResponse):
    """Expanded entity detail record."""

    source_ids: list[str] = Field(default_factory=list)
    relationship_ids: list[str] = Field(default_factory=list)
    sources: list[SourceResponse] = Field(default_factory=list)


class EntitySourcesResponse(BaseModel):
    """Source list for a single entity."""

    entity_id: str
    sources: list[SourceResponse] = Field(default_factory=list)


class EntityCollectionResponse(BaseModel):
    """Collection response for entities."""

    items: list[EntityResponse] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None
    facets: dict[str, list[FacetOption]] | None = None
    place: Address | None = None


class SourceCollectionResponse(BaseModel):
    """Collection response for sources."""

    items: list[SourceResponse] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None
    place: Address | None = None


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


class EntityRelationship(BaseModel):
    """Derived relationship metadata."""

    type: str
    issue_area_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)


class EntityRelationshipItem(BaseModel):
    """Related entity plus its relationships."""

    entity: EntityResponse
    relationships: list[EntityRelationship] = Field(default_factory=list)


class EntityRelationshipsResponse(BaseModel):
    """Related-entity collection."""

    entity_id: str
    items: list[EntityRelationshipItem] = Field(default_factory=list)


class DomainResponse(BaseModel):
    """Domain summary resource."""

    slug: str
    name: str
    issue_area_count: int


class DomainListResponse(BaseModel):
    """Collection response for domains."""

    items: list[DomainResponse] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None


class DomainDetailResponse(BaseModel):
    """Domain detail resource."""

    slug: str
    name: str
    issue_areas: list[IssueAreaResponse] = Field(default_factory=list)


class DiscoveryRunCollectionResponse(BaseModel):
    """Collection response for discovery runs."""

    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None
