"""Public catalog entity and source schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .public_common import (
    ActorQualityInfo,
    Address,
    ClaimEvidenceSet,
    ClaimStatusInfo,
    ContactInfo,
    FacetOption,
    FlagSummary,
    FreshnessInfo,
    ProfileAnswers,
    SourceLinkedEntityResponse,
    TrustInfo,
)

__all__ = [
    "DiscoveryRunCollectionResponse",
    "DomainDetailResponse",
    "DomainListResponse",
    "DomainResponse",
    "EntityCollectionResponse",
    "EntityDetailResponse",
    "EntityRelationship",
    "EntityRelationshipItem",
    "EntityRelationshipsResponse",
    "EntityResponse",
    "EntitySourcesResponse",
    "SourceCollectionResponse",
    "SourceResponse",
]


class EntityResponse(BaseModel):
    """Canonical public entity shape."""

    id: str
    type: str
    name: str
    description: str
    custom_bio: str | None = Field(
        None,
        description="Subject-authored bio that overrides the auto-generated description on display.",
    )
    photo_url: str | None = Field(
        None,
        description="Subject-uploaded photo or org logo. Null until a verified subject uploads one.",
    )
    address: Address
    contact: ContactInfo
    preferred_contact_channel: str | None = Field(
        None,
        description="Subject preference for which channel readers should use to make contact.",
    )
    affiliated_org_id: str | None = None
    active: bool
    verified: bool
    claim: ClaimStatusInfo = Field(default_factory=ClaimStatusInfo)
    claim_evidence: ClaimEvidenceSet
    profile_answers: ProfileAnswers
    trust: TrustInfo = Field(default_factory=TrustInfo)
    actor_quality: ActorQualityInfo = Field(default_factory=ActorQualityInfo)
    issue_area_ids: list[str] = Field(default_factory=list)
    source_types: list[str] = Field(default_factory=list)
    source_count: int = 0
    freshness: FreshnessInfo
    flag_summary: FlagSummary = Field(default_factory=FlagSummary)
    slug: str | None = Field(None, description="Human-readable URL slug (e.g., jane-doe-a3f2).")
    created_at: str
    updated_at: str
    resource_uri: str
    profile_url: str | None = Field(
        None,
        description="Absolute URL to the entity's public profile page, when derivable.",
    )


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
    linked_entities: list[SourceLinkedEntityResponse] = Field(default_factory=list)
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
    total: int = 0
    next_cursor: str | None = None


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
    total: int = 0
    next_cursor: str | None = None


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
    issue_areas: list[Any] = Field(default_factory=list)


class DiscoveryRunCollectionResponse(BaseModel):
    """Collection response for discovery runs."""

    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int
    next_cursor: str | None = None
