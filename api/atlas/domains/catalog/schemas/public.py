"""Canonical public Pydantic models shared by REST and MCP."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ActorQualityInfo",
    "Address",
    "ClaimEvidence",
    "ClaimEvidenceSet",
    "ClaimStatusInfo",
    "ConnectedActorResponse",
    "ConnectionReasonResponse",
    "ContactInfo",
    "CoverageCount",
    "DiscoveryRunCollectionResponse",
    "DomainDetailResponse",
    "DomainListResponse",
    "DomainResponse",
    "EntityCollectionResponse",
    "EntityConnectionsResponse",
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
    "MapPoint",
    "MapPointCollectionResponse",
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
    "ProfileAnswers",
    "ProfileClaimRequest",
    "ProfileClaimResponse",
    "ProfileClaimVerifyRequest",
    "ProfileFollowResponse",
    "ProfileManageRequest",
    "SavedListCreateRequest",
    "SavedListExportItemResponse",
    "SavedListExportProvenance",
    "SavedListExportResponse",
    "SavedListExportSource",
    "SavedListItemRequest",
    "SavedListItemResponse",
    "SavedListResponse",
    "SourceCollectionResponse",
    "SourceFlagCreateRequest",
    "SourceFlagListResponse",
    "SourceLinkedEntityResponse",
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


class SourceLinkedEntityResponse(BaseModel):
    """Minimal entity summary linked to a source."""

    id: str
    name: str
    type: str
    slug: str | None = None


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
    """One placed civic actor, reduced to what the map dot renders.

    Deliberately tiny so thousands can be sent for a viewport and re-clustered
    client-side without a round trip. ``trust_level`` mirrors the canonical,
    never-overclaiming tiers so a dot's ring matches the profile it links to.
    """

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
    """Honest trust signals derived from corroborating evidence.

    ``level`` never overclaims: an auto-discovered entity backed by a single
    source domain is ``unverified``, not authoritative-sounding. Grounding flags
    are ``None`` when corroboration could not be evaluated (for example, in list
    responses that do not load full source text).
    """

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


class ProfileClaimRequest(BaseModel):
    """Initiate a claim for a profile.

    `evidence` is required only for tier-2 (manual review) claims.
    """

    relationship: str | None = None
    evidence: str | None = None
    requested_changes: str | None = None
    preferred_contact_channel: str | None = None
    private_note: str | None = None


class ProfileClaimVerifyRequest(BaseModel):
    """Tier-1 email-link callback payload."""

    token: str


class ProfileClaimResponse(BaseModel):
    """Profile-claim resource."""

    id: str
    entry_id: str
    entry_slug: str | None = None
    entry_name: str
    user_id: str
    user_email: str
    status: str
    tier: int
    evidence: Any | None = None
    verified_at: str | None = None
    rejected_reason: str | None = None
    created_at: str
    updated_at: str


class ProfileManageRequest(BaseModel):
    """Subject-managed mutable fields on a claimed profile."""

    photo_url: str | None = None
    custom_bio: str | None = None
    suppressed_source_ids: list[str] | None = None
    preferred_contact_channel: str | None = None
    clear_photo: bool = Field(
        False,
        description="Set true to drop the existing photo_url. Photo_url field is ignored if true.",
    )
    clear_custom_bio: bool = Field(
        False,
        description="Set true to drop the existing custom_bio. The auto-generated description returns.",
    )


class SavedListCreateRequest(BaseModel):
    """Create a new saved-actor list."""

    name: str
    description: str | None = None


class SavedListItemRequest(BaseModel):
    """Add an entry to a saved list."""

    entry_id: str
    note: str | None = None


class SavedListItemResponse(BaseModel):
    """Single list-item record."""

    list_id: str
    entry_id: str
    note: str | None = None
    added_at: str
    entry: EntityResponse | None = None


class SavedListResponse(BaseModel):
    """Saved-list resource with item count."""

    id: str
    user_id: str
    name: str
    description: str | None = None
    item_count: int = 0
    items: list[SavedListItemResponse] = Field(default_factory=list)
    created_at: str
    updated_at: str


class SavedListExportProvenance(BaseModel):
    """Provenance summary for a saved-list export."""

    item_count: int = Field(0, ge=0)
    source_count: int = Field(0, ge=0)


class SavedListExportSource(BaseModel):
    """Source receipt included in a saved-list export row."""

    id: str
    url: str
    title: str | None = None
    publication: str | None = None
    type: str | None = None


class SavedListExportItemResponse(BaseModel):
    """Saved-list export row with actor, notes, and evidence receipts."""

    list_id: str
    entry_id: str
    note: str | None = None
    added_at: str
    entry: EntityResponse | None = None
    trust_level: str = "unverified"
    sources: list[SavedListExportSource] = Field(default_factory=list)


class SavedListExportResponse(BaseModel):
    """Downloadable saved-list export with hydrated actor rows."""

    model_config = ConfigDict(populate_by_name=True)

    format: Literal["json"] = "json"
    list_: SavedListResponse = Field(alias="list")
    items: list[SavedListExportItemResponse] = Field(default_factory=list)
    provenance: SavedListExportProvenance


class ProfileFollowResponse(BaseModel):
    """Follow subscription resource."""

    user_id: str
    entry_id: str
    subscribed_to: str
    created_at: str
