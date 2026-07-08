"""Shared public catalog schemas for identity, trust, and map projections."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

__all__ = [
    "ActorQualityInfo",
    "Address",
    "ClaimEvidence",
    "ClaimEvidenceSet",
    "ClaimStatusInfo",
    "ConnectedActorResponse",
    "ConnectionReasonResponse",
    "ContactInfo",
    "EntityConnectionsResponse",
    "EntityFlagCreateRequest",
    "EntityFlagListResponse",
    "FacetOption",
    "FlagResponse",
    "FlagSummary",
    "FreshnessInfo",
    "MapPoint",
    "MapPointCollectionResponse",
    "ProfileAnswers",
    "ReviewQueueItemResponse",
    "ReviewQueueListResponse",
    "SourceFlagCreateRequest",
    "SourceFlagListResponse",
    "SourceLinkedEntityResponse",
    "TrustInfo",
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


class SourceLinkedEntityResponse(BaseModel):
    """Minimal entity summary linked to a source."""

    id: str
    name: str
    type: str
    slug: str | None = None
    issue_area_ids: list[str] = Field(default_factory=list)


class ReviewQueueItemResponse(BaseModel):
    """A discovered record held for human review before publication."""

    id: str
    org_id: str | None = None
    entity_id: str | None = None
    kind: str
    status: str
    hold_reason: str
    score: float | None = None
    dedup_suspect: bool
    dedup_note: str | None = None
    created_at: str
    reviewed_at: str | None = None
    reviewed_by: str | None = None


class ReviewQueueListResponse(BaseModel):
    """Pending review-queue collection."""

    items: list[ReviewQueueItemResponse] = Field(default_factory=list)
    total: int


class FacetOption(BaseModel):
    """A single filter option with result count."""

    value: str
    count: int


class MapPoint(BaseModel):
    """One placed civic actor, reduced to what the map dot renders."""

    id: str
    name: str
    type: str
    slug: str | None = None
    place_label: str | None = None
    geo_specificity: str | None = None
    geocode_precision: Literal["rooftop", "city", "state"] | None = None
    geocode_source: Literal["census", "gazetteer", "manual"] | None = None
    lat: float
    lng: float
    issue_areas: list[str] = Field(default_factory=list)
    source_count: int = Field(..., ge=0)
    latest_source_date: str | None = None
    trust_level: str = Field(
        description="subject_verified | atlas_verified | corroborated | unverified.",
    )


class MapPointCollectionResponse(BaseModel):
    """The placed actors inside a viewport, with an honest overflow signal."""

    points: list[MapPoint] = Field(default_factory=list)
    total: int = Field(description="Placed actors inside the viewport before the cap.")
    capped: bool = Field(
        description="True when the viewport held more actors than the limit returned.",
    )


class ConnectionReasonResponse(BaseModel):
    """One explainable reason two actors are connected."""

    kind: str = Field(
        description="same_organization | sourced_edge | co_mentioned | same_issue_area | same_geography.",
    )
    label: str
    count: int | None = None
    source_id: str | None = Field(
        default=None,
        description="Source supporting this reason when the connection is persisted as evidence.",
    )
    relationship_type: str | None = Field(
        default=None,
        description="Semantic relationship type for sourced edges, such as staff or coalition_partner.",
    )


class ConnectedActorResponse(BaseModel):
    """A ranked connected actor on an entity's civic map."""

    id: str
    name: str
    type: str
    slug: str | None = None
    description_snippet: str | None = None
    score: float = Field(description="Raw weighted connection score.")
    strength: int = Field(
        description="Connection strength 0-100, relative to the strongest link.",
    )
    tier: str = Field(description="strong | moderate | weak.")
    reasons: list[ConnectionReasonResponse] = Field(default_factory=list)
    evidence: str = Field(description="The single strongest reason, for compact display.")


class EntityConnectionsResponse(BaseModel):
    """An entity's ranked connection network with the true total."""

    actors: list[ConnectedActorResponse] = Field(default_factory=list)
    total: int = Field(description="Total connected actors before pagination.")


class ClaimStatusInfo(BaseModel):
    """Claim ownership state for a profile."""

    status: str = Field(
        "unclaimed",
        description="Lifecycle of subject ownership: unclaimed, pending, verified, revoked.",
    )
    claimed_by_user_id: str | None = None
    claim_verified_at: str | None = None
    verification_level: str = Field(
        "source-derived",
        description="Trust tier: source-derived, atlas-verified, subject-verified.",
    )
    linked_atproto_handle: str | None = Field(
        None,
        description="Verified ATProto handle linked to the profile.",
    )
    linked_atproto_did: str | None = Field(
        None,
        description="Stable ATProto DID behind the verified linked handle.",
    )
    linked_atproto_verified_at: str | None = None


class ClaimEvidence(BaseModel):
    """Evidence metadata for one visible profile claim."""

    source_count: int = Field(0, ge=0)
    source_ids: list[str] = Field(default_factory=list)
    confidence: str = Field(
        "unverified",
        description="subject_verified | atlas_verified | corroborated | partial | unverified.",
    )
    as_of: str | None = Field(None, description="Most recent date supporting this claim.")
    verification_level: str = Field(
        "source-derived",
        description="Trust tier: source-derived, atlas-verified, subject-verified.",
    )


class ClaimEvidenceSet(BaseModel):
    """Evidence metadata grouped by the visible facts on a profile."""

    summary: ClaimEvidence
    place: ClaimEvidence
    issues: ClaimEvidence
    contact: ClaimEvidence


class ProfileAnswers(BaseModel):
    """Scan-friendly answers that make actor profiles usable outside the app."""

    who: str
    what_they_do: str
    where: str
    why_they_matter: str
    how_atlas_knows: str


class TrustInfo(BaseModel):
    """Honest trust signals derived from corroborating evidence."""

    level: str = Field(
        "unverified",
        description="subject_verified | atlas_verified | corroborated | unverified.",
    )
    independent_source_count: int | None = Field(
        None,
        description="Distinct registrable source domains backing the entity, when known.",
    )
    website_grounded: bool | None = Field(
        None,
        description="Whether the listed website is supported by a linked source.",
    )
    email_grounded: bool | None = Field(
        None,
        description="Whether the listed email is supported by a linked source.",
    )


class ActorQualityInfo(BaseModel):
    """Specificity signals showing whether a record is a concrete actor lead."""

    level: str = Field(
        "thin_record",
        description="specific_actor | partial_actor | thin_record.",
    )
    score: int = Field(0, ge=0)
    total: int = Field(5, ge=1)
    present: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
