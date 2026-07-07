"""Shared Firehose persistence record types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, cast

from atlas.platform.database import db

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


def decode_string_list(value: str) -> list[str]:
    """Decode a JSON string list, returning an empty list for malformed values."""
    decoded = db.decode_json(value)
    if isinstance(decoded, list) and all(isinstance(item, str) for item in decoded):
        return decoded
    return []


def row_dict(cursor: Any, row: Any) -> dict[str, Any]:
    """Return a dictionary for a DB row using cursor descriptions."""
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row, strict=False))


def source_target_from_row(row: dict[str, Any]) -> FirehoseSourceTargetModel:
    """Build a source target model from a database row."""
    return FirehoseSourceTargetModel(
        id=str(row["id"]),
        org_id=str(row["org_id"]),
        coverage_target_id=str(row["coverage_target_id"]),
        label=str(row["label"]),
        url=str(row["url"]),
        source_kind=cast("FirehoseSourceKind", row["source_kind"]),
        source_class=str(row["source_class"]),
        places=decode_string_list(str(row["places_json"])),
        issues=decode_string_list(str(row["issues_json"])),
        priority=cast("FirehoseSourcePriority", row["priority"]),
        cadence_seconds=int(row["cadence_seconds"]),
        enabled=bool(row["enabled"]),
        safety_policy=cast("FirehoseSourceSafetyPolicy", row["safety_policy"]),
        public_route_enabled=bool(row["public_route_enabled"]),
        origin=cast("FirehoseSourceOrigin", row["origin"]),
        origin_note=row["origin_note"],
        last_checked_at=row["last_checked_at"],
        last_success_at=row["last_success_at"],
        last_error=row["last_error"],
        last_http_status=row["last_http_status"],
        etag=row["etag"],
        last_modified=row["last_modified"],
        content_hash=row["content_hash"],
        created_by=str(row["created_by"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def artifact_from_row(row: dict[str, Any]) -> FirehoseArtifactModel:
    """Build an artifact model from a database row."""
    return FirehoseArtifactModel(
        id=str(row["id"]),
        source_target_id=str(row["source_target_id"]),
        org_id=str(row["org_id"]),
        coverage_target_id=str(row["coverage_target_id"]),
        source_url=str(row["source_url"]),
        canonical_url=str(row["canonical_url"]),
        title=str(row["title"]),
        publisher=row["publisher"],
        source_kind=cast("FirehoseSourceKind", row["source_kind"]),
        source_class=str(row["source_class"]),
        published_at=row["published_at"],
        detected_at=str(row["detected_at"]),
        fetched_at=str(row["fetched_at"]),
        content_hash=str(row["content_hash"]),
        fingerprint=str(row["fingerprint"]),
        relevant_text=str(row["relevant_text"]),
        raw_content=row["raw_content"],
        http_status=row["http_status"],
        metadata_json=str(row["metadata_json"]),
    )


def observation_from_row(row: dict[str, Any]) -> FirehoseObservationModel:
    """Build an observation model from a database row."""
    return FirehoseObservationModel(
        id=str(row["id"]),
        producer=cast("FirehoseObservationProducer", row["producer"]),
        observation_type=str(row["observation_type"]),
        subject_type=str(row["subject_type"]),
        subject_id=row["subject_id"],
        org_id=row["org_id"],
        coverage_target_id=row["coverage_target_id"],
        places=decode_string_list(str(row["places_json"])),
        issues=decode_string_list(str(row["issues_json"])),
        source_class=row["source_class"],
        occurred_at=row["occurred_at"],
        observed_at=str(row["observed_at"]),
        dedupe_key=str(row["dedupe_key"]),
        public_realm_basis=str(row["public_realm_basis"]),
        confidence=float(row["confidence"]),
        sensitivity=float(row["sensitivity"]),
        payload_json=str(row["payload_json"]),
        evidence_json=str(row["evidence_json"]),
        status=cast("FirehoseObservationStatus", row["status"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def route_from_row(row: dict[str, Any]) -> FirehoseRouteModel:
    """Build a route model from a database row."""
    return FirehoseRouteModel(
        id=str(row["id"]),
        signal_id=str(row["signal_id"]),
        destination_type=cast("FirehoseRouteDestinationType", row["destination_type"]),
        destination_id=row["destination_id"],
        state=cast("FirehoseRouteState", row["state"]),
        route_reason=str(row["route_reason"]),
        routed_at=str(row["routed_at"]),
    )
