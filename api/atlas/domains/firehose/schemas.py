"""Schemas for the Firehose query and observation surface."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

FirehoseActorType = Literal["person", "organization", "initiative", "campaign", "event"]
FirehoseDeliveryMode = Literal["sse", "websocket"]
FirehoseReviewState = Literal["not_required", "pending", "approved", "held", "rejected"]
FirehoseSignalType = Literal[
    "public_meeting",
    "public_comment",
    "vote",
    "filing",
    "grant_award",
    "coalition_activity",
    "new_source",
    "role_change",
    "freshness_change",
]
FirehoseSort = Literal["detected_at_desc", "occurred_at_desc", "relevance_desc"]
FirehoseUsageMeter = Literal[
    "firehose_snapshot",
    "firehose_session",
    "firehose_stream",
    "firehose_socket",
]
FirehoseVisibility = Literal["workspace", "partner", "public", "reviewer"]


class FirehoseQueryParams(BaseModel):
    """Raw URL query parameters for the Firehose query surface."""

    place: list[str] = Field(default_factory=list)
    issue: list[str] = Field(default_factory=list)
    actor_type: list[FirehoseActorType] = Field(default_factory=list)
    signal_type: list[FirehoseSignalType] = Field(default_factory=list)
    source_class: list[str] = Field(default_factory=list)
    visibility: FirehoseVisibility = "workspace"
    since: str | None = None
    until: str | None = None
    cursor: str | None = None
    limit: int = Field(default=50, ge=1, le=200)
    sort: FirehoseSort = "detected_at_desc"

    @field_validator("place", "issue", "actor_type", "signal_type", "source_class", mode="before")
    @classmethod
    def normalize_multi_value(cls, value: Any) -> list[str]:
        """Accept repeated or comma-delimited query parameter values."""
        if value is None:
            return []
        values = value if isinstance(value, list) else [value]
        normalized: list[str] = []
        for item in values:
            normalized.extend(part.strip() for part in str(item).split(",") if part.strip())
        return normalized

    def to_query(self) -> FirehoseQuery:
        """Convert raw URL parameters into the canonical Firehose query."""
        return FirehoseQuery(
            places=self.place,
            issues=self.issue,
            actor_types=self.actor_type,
            signal_types=self.signal_type,
            source_classes=self.source_class,
            visibility=self.visibility,
            since=self.since,
            until=self.until,
            cursor=self.cursor,
            limit=self.limit,
            sort=self.sort,
        )


class FirehoseQuery(BaseModel):
    """Normalized Firehose query filters."""

    places: list[str] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    actor_types: list[FirehoseActorType] = Field(default_factory=list)
    signal_types: list[FirehoseSignalType] = Field(default_factory=list)
    source_classes: list[str] = Field(default_factory=list)
    visibility: FirehoseVisibility = "workspace"
    since: str | None = None
    until: str | None = None
    cursor: str | None = None
    limit: int = Field(default=50, ge=1, le=200)
    sort: FirehoseSort = "detected_at_desc"


class FirehoseWorkspaceContext(BaseModel):
    """Workspace and actor context that owns Firehose usage."""

    org_id: str
    actor_id: str
    auth_type: str
    api_key_id: str | None = None


class FirehoseUsageContext(BaseModel):
    """Billing and metering context for one Firehose request."""

    meter: FirehoseUsageMeter
    query_fingerprint: str


class FirehoseSummary(BaseModel):
    """Counts for the current Firehose view."""

    total_signals: int = Field(..., ge=0)
    visible_signals: int = Field(..., ge=0)
    held_signals: int = Field(..., ge=0)
    latest_cursor: str | None


class FirehoseLinkSet(BaseModel):
    """HTTP and client links for the current Firehose view."""

    self: str
    next: str | None
    events: str | None


class FirehoseEvidence(BaseModel):
    """Public evidence backing one Firehose signal."""

    source_url: str
    title: str | None
    publisher: str | None
    published_at: str | None
    captured_at: str
    passage: str
    locator: str | None
    content_hash: str


class FirehoseActorRef(BaseModel):
    """Actor reference attached to one Firehose signal."""

    id: str | None
    name: str
    type: FirehoseActorType
    role: str


class FirehoseDestination(BaseModel):
    """Destination where a Firehose signal is allowed to appear."""

    type: Literal["workspace", "profile", "place", "issue", "partner", "public", "review"]
    id: str | None
    state: Literal["active", "held", "suppressed"]


class FirehoseSignal(BaseModel):
    """Source-backed civic signal returned by Firehose."""

    id: str
    type: FirehoseSignalType
    title: str
    summary: str
    occurred_at: str | None
    detected_at: str
    public_realm_basis: str
    places: list[str]
    issues: list[str]
    actors: list[FirehoseActorRef]
    confidence: float = Field(..., ge=0, le=1)
    sensitivity: float = Field(..., ge=0, le=1)
    review_state: FirehoseReviewState
    visibility: FirehoseVisibility
    evidence: list[FirehoseEvidence]
    destinations: list[FirehoseDestination]


class FirehoseSession(BaseModel):
    """Durable observed Firehose query."""

    id: str
    state: Literal["active", "expired"]
    query: FirehoseQuery
    workspace: FirehoseWorkspaceContext
    usage: FirehoseUsageContext
    created_at: str
    expires_at: str
    snapshot_url: str
    events_url: str
    socket_url: str


class FirehoseSnapshot(BaseModel):
    """Point-in-time Firehose query result."""

    query: FirehoseQuery
    workspace: FirehoseWorkspaceContext
    usage: FirehoseUsageContext
    generated_at: str
    cursor: str | None
    summary: FirehoseSummary
    signals: list[FirehoseSignal]
    links: FirehoseLinkSet
    session: FirehoseSession | None = None


class FirehoseDeliveryRequest(BaseModel):
    """Requested delivery mode for a durable Firehose session."""

    mode: FirehoseDeliveryMode = "sse"


class FirehoseSessionRequest(BaseModel):
    """Request to create a durable Firehose observed query."""

    query: FirehoseQuery
    delivery: FirehoseDeliveryRequest = Field(default_factory=FirehoseDeliveryRequest)


class FirehoseReadyEvent(BaseModel):
    """Readiness event emitted when a Firehose stream opens."""

    type: Literal["firehose.ready"] = "firehose.ready"
    session_id: str | None
    workspace: FirehoseWorkspaceContext
    usage: FirehoseUsageContext
    query: FirehoseQuery
    last_event_id: str | None


class FirehoseHeartbeatEvent(BaseModel):
    """Heartbeat event emitted by a Firehose stream."""

    type: Literal["heartbeat"] = "heartbeat"
    session_id: str | None


class FirehoseSignalEvent(BaseModel):
    """Signal event emitted when a Firehose stream delivers a civic signal."""

    type: Literal["firehose.signal"] = "firehose.signal"
    event_id: str
    session_id: str | None
    workspace: FirehoseWorkspaceContext
    usage: FirehoseUsageContext
    query: FirehoseQuery
    signal: FirehoseSignal
    delivered_at: str
