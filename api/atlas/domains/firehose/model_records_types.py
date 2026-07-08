"""Shared Firehose persistence record types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

FirehoseSourceKind = Literal["rss", "atom", "web_page"]
FirehoseSourcePriority = Literal["hot", "warm"]
FirehoseSourceSafetyPolicy = Literal["standard", "person_review_required", "review_all"]
FirehoseSourceOrigin = Literal["manual", "scout_sync", "api", "system"]
FirehoseRouteState = Literal["active", "held", "suppressed"]
FirehoseRouteDestinationType = Literal["workspace", "profile", "place", "issue", "public", "review"]
FirehoseObservationProducer = Literal[
    "source_target",
    "discovery_sync",
    "catalog",
    "profile_claim",
    "review",
]
FirehoseObservationStatus = Literal["observed", "signals_created", "ignored", "failed"]
FirehoseObservationDeliveryStatus = Literal["pending", "claimed", "delivered", "failed"]


@dataclass(slots=True)
class FirehoseSourceTargetCreate:
    """Input for one workspace-owned Firehose source target."""

    org_id: str
    coverage_target_id: str
    label: str
    url: str
    source_kind: FirehoseSourceKind
    source_class: str
    places: list[str]
    issues: list[str]
    created_by: str
    priority: FirehoseSourcePriority = "hot"
    cadence_seconds: int = 60
    enabled: bool = True
    safety_policy: FirehoseSourceSafetyPolicy = "standard"
    public_route_enabled: bool = False
    origin: FirehoseSourceOrigin = "manual"
    origin_note: str | None = None


@dataclass(slots=True)
class FirehoseSourceTargetModel:
    """Stored Firehose source target."""

    id: str
    org_id: str
    coverage_target_id: str
    label: str
    url: str
    source_kind: FirehoseSourceKind
    source_class: str
    places: list[str]
    issues: list[str]
    priority: FirehoseSourcePriority
    cadence_seconds: int
    enabled: bool
    safety_policy: FirehoseSourceSafetyPolicy
    public_route_enabled: bool
    origin: FirehoseSourceOrigin
    origin_note: str | None
    last_checked_at: str | None
    last_success_at: str | None
    last_error: str | None
    last_http_status: int | None
    etag: str | None
    last_modified: str | None
    content_hash: str | None
    created_by: str
    created_at: str
    updated_at: str


@dataclass(slots=True)
class FirehoseArtifactCreate:
    """Input for one immutable collected Firehose artifact."""

    source_target_id: str
    org_id: str
    coverage_target_id: str
    source_url: str
    canonical_url: str
    title: str
    publisher: str | None
    source_kind: FirehoseSourceKind
    source_class: str
    published_at: str | None
    detected_at: str
    fetched_at: str
    content_hash: str
    fingerprint: str
    relevant_text: str
    raw_content: str | None
    http_status: int | None
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class FirehoseArtifactModel:
    """Stored Firehose artifact."""

    id: str
    source_target_id: str
    org_id: str
    coverage_target_id: str
    source_url: str
    canonical_url: str
    title: str
    publisher: str | None
    source_kind: FirehoseSourceKind
    source_class: str
    published_at: str | None
    detected_at: str
    fetched_at: str
    content_hash: str
    fingerprint: str
    relevant_text: str
    raw_content: str | None
    http_status: int | None
    metadata_json: str


@dataclass(slots=True)
class FirehoseObservationCreate:
    """Input for one platform-wide civic observation."""

    producer: FirehoseObservationProducer
    observation_type: str
    subject_type: str
    subject_id: str | None
    org_id: str | None
    coverage_target_id: str | None
    places: list[str]
    issues: list[str]
    source_class: str | None
    occurred_at: str | None
    observed_at: str
    dedupe_key: str
    public_realm_basis: str
    confidence: float
    sensitivity: float
    payload: dict[str, object] = field(default_factory=dict)
    evidence: list[dict[str, object]] = field(default_factory=list)


@dataclass(slots=True)
class FirehoseObservationModel:
    """Stored platform-wide civic observation."""

    id: str
    producer: FirehoseObservationProducer
    observation_type: str
    subject_type: str
    subject_id: str | None
    org_id: str | None
    coverage_target_id: str | None
    places: list[str]
    issues: list[str]
    source_class: str | None
    occurred_at: str | None
    observed_at: str
    dedupe_key: str
    public_realm_basis: str
    confidence: float
    sensitivity: float
    payload_json: str
    evidence_json: str
    status: FirehoseObservationStatus
    created_at: str
    updated_at: str


@dataclass(slots=True)
class FirehoseObservationDeliveryModel:
    """Durable delivery state for one stored observation."""

    id: str
    observation_id: str
    status: FirehoseObservationDeliveryStatus
    attempts: int
    claimed_by: str | None
    claimed_until: str | None
    next_attempt_at: str
    last_error: str | None
    delivered_at: str | None
    created_at: str
    updated_at: str


@dataclass(slots=True)
class FirehoseSignalCreate:
    """Input for one stored Firehose signal."""

    artifact_id: str | None
    org_id: str
    coverage_target_id: str | None
    signal_type: str
    title: str
    summary: str
    occurred_at: str | None
    detected_at: str
    public_realm_basis: str
    places: list[str]
    issues: list[str]
    actors: list[dict[str, object]]
    confidence: float
    sensitivity: float
    review_state: str
    visibility: str
    route_state: str
    primary_observation_id: str | None = None
    signal_key: str | None = None


@dataclass(slots=True)
class FirehoseEvidenceModel:
    """Evidence attached to one stored signal."""

    source_url: str
    title: str | None
    publisher: str | None
    published_at: str | None
    captured_at: str
    passage: str
    locator: str | None
    content_hash: str
    source_class: str


@dataclass(slots=True)
class FirehoseDestinationModel:
    """Destination attached to one stored signal."""

    type: FirehoseRouteDestinationType
    id: str | None
    state: FirehoseRouteState


@dataclass(slots=True)
class FirehoseSignalModel:
    """Stored Firehose signal with source evidence and routes."""

    id: str
    artifact_id: str | None
    primary_observation_id: str | None
    signal_key: str | None
    type: str
    title: str
    summary: str
    occurred_at: str | None
    detected_at: str
    public_realm_basis: str
    places: list[str]
    issues: list[str]
    actors_json: str
    confidence: float
    sensitivity: float
    review_state: str
    visibility: str
    route_state: str
    evidence: list[FirehoseEvidenceModel]
    destinations: list[FirehoseDestinationModel]


@dataclass(slots=True)
class FirehoseRouteCreate:
    """Input for one Firehose signal route."""

    signal_id: str
    destination_type: FirehoseRouteDestinationType
    destination_id: str | None
    state: FirehoseRouteState
    route_reason: str


@dataclass(slots=True)
class FirehoseRouteModel:
    """Stored Firehose route."""

    id: str
    signal_id: str
    destination_type: FirehoseRouteDestinationType
    destination_id: str | None
    state: FirehoseRouteState
    route_reason: str
    routed_at: str


@dataclass(slots=True)
class FirehoseSignalQuery:
    """Filter set for stored Firehose signals."""

    org_id: str | None = None
    places: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    signal_types: list[str] = field(default_factory=list)
    source_classes: list[str] = field(default_factory=list)
    visibility: str = "workspace"
    limit: int = 50
