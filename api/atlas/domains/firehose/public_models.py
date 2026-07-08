"""Public Firehose proof feed models and fixtures."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

PublicSignalType = Literal[
    "public_meeting",
    "public_comment",
    "vote",
    "filing",
    "coalition_activity",
    "grant_award",
    "new_source",
    "role_change",
    "freshness_change",
    "actor_discovered",
    "source_attached",
    "relationship_observed",
    "profile_claimed",
    "review_decision",
    "coverage_gap",
]
PublicReviewState = Literal["not_required", "pending", "approved", "held"]
PublicVisibility = Literal["public", "workspace", "reviewer"]


class PublicFirehoseQueryParams(BaseModel):
    """Raw public Firehose query parameters."""

    place: list[str] = Field(default_factory=list)
    issue: list[str] = Field(default_factory=list)
    signal_type: list[str] = Field(default_factory=list)
    source_class: list[str] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=50)

    @field_validator("place", "issue", "signal_type", "source_class", mode="before")
    @classmethod
    def normalize_multi_value(cls, value: Any) -> list[str]:
        """Accept repeated or comma-delimited query values."""
        if value is None:
            return []
        values = value if isinstance(value, list) else [value]
        normalized: list[str] = []
        for item in values:
            normalized.extend(part.strip() for part in str(item).split(",") if part.strip())
        return normalized


class PublicFirehosePlace(BaseModel):
    """Public place label attached to a signal."""

    label: str
    slug: str


class PublicFirehoseIssue(BaseModel):
    """Public issue label attached to a signal."""

    label: str
    slug: str


class PublicFirehoseEvidence(BaseModel):
    """Public source evidence for one signal."""

    captured_at: str
    content_hash: str
    passage: str
    published_at: str | None
    publisher: str
    source_class: str
    source_url: str
    title: str


class PublicFirehoseSignal(BaseModel):
    """Public-safe Firehose signal."""

    confidence: float = Field(..., ge=0, le=1)
    detected_at: str
    evidence: PublicFirehoseEvidence
    id: str
    issues: list[PublicFirehoseIssue]
    occurred_at: str | None
    places: list[PublicFirehosePlace]
    public_realm_basis: str
    review_state: PublicReviewState
    sensitivity: float = Field(..., ge=0, le=1)
    signal_type: PublicSignalType
    summary: str
    title: str
    visibility: PublicVisibility


class PublicFirehoseSummary(BaseModel):
    """Summary of the public Firehose snapshot."""

    latest_detected_at: str | None
    total_signals: int = Field(..., ge=0)
    visible_signals: int = Field(..., ge=0)


class PublicFirehoseSnapshot(BaseModel):
    """Public Firehose feed snapshot."""

    generated_at: str
    query: PublicFirehoseQueryParams
    signals: list[PublicFirehoseSignal]
    summary: PublicFirehoseSummary


class PublicFirehoseReadyEvent(BaseModel):
    """Public Firehose stream readiness event."""

    query: PublicFirehoseQueryParams
    type: Literal["firehose.ready"] = "firehose.ready"


class PublicFirehoseSignalEvent(BaseModel):
    """Public Firehose signal event."""

    signal: PublicFirehoseSignal
    type: Literal["firehose.signal"] = "firehose.signal"


class PublicFirehoseHeartbeatEvent(BaseModel):
    """Public Firehose heartbeat event."""

    type: Literal["heartbeat"] = "heartbeat"


PUBLIC_FIREHOSE_FIXTURES: tuple[PublicFirehoseSignal, ...] = (
    PublicFirehoseSignal(
        confidence=0.86,
        detected_at="2026-07-06T22:10:00Z",
        evidence=PublicFirehoseEvidence(
            captured_at="2026-07-06T22:10:00Z",
            content_hash="sha256:detroit-night-bus-agenda",
            passage=(
                "The board posted a hearing agenda for proposed night bus service changes and "
                "public comment."
            ),
            published_at="2026-07-06T21:58:00Z",
            publisher="Detroit Transit Board",
            source_class="government_agenda",
            source_url="https://detroit.example/agendas/night-bus",
            title="Night bus hearing agenda",
        ),
        id="fh_public_detroit_hearing_agenda",
        issues=[PublicFirehoseIssue(label="Transit", slug="transit")],
        occurred_at="2026-07-08T00:30:00Z",
        places=[PublicFirehosePlace(label="Detroit, MI", slug="detroit-mi")],
        public_realm_basis="Published public meeting agenda",
        review_state="not_required",
        sensitivity=0.12,
        signal_type="public_meeting",
        summary=(
            "Detroit transit officials posted a public hearing agenda for proposed night bus "
            "service changes."
        ),
        title="Transit board posts night bus hearing agenda",
        visibility="public",
    ),
    PublicFirehoseSignal(
        confidence=0.82,
        detected_at="2026-07-06T21:42:00Z",
        evidence=PublicFirehoseEvidence(
            captured_at="2026-07-06T21:43:00Z",
            content_hash="sha256:las-vegas-housing-coalition",
            passage=(
                "A coalition of tenant, faith, and neighborhood groups announced a "
                "rent-stability forum."
            ),
            published_at="2026-07-06T21:20:00Z",
            publisher="Clark County Housing Table",
            source_class="organization_update",
            source_url="https://lasvegas.example/updates/rent-forum",
            title="Rent stability forum announcement",
        ),
        id="fh_public_las_vegas_coalition",
        issues=[PublicFirehoseIssue(label="Housing", slug="housing")],
        occurred_at="2026-07-12T01:00:00Z",
        places=[PublicFirehosePlace(label="Las Vegas, NV", slug="las-vegas-nv")],
        public_realm_basis="Published organization update",
        review_state="not_required",
        sensitivity=0.18,
        signal_type="coalition_activity",
        summary=(
            "A local housing coalition announced a public forum with tenant, faith, and "
            "neighborhood groups."
        ),
        title="Housing coalition announces rent-stability forum",
        visibility="public",
    ),
    PublicFirehoseSignal(
        confidence=0.8,
        detected_at="2026-07-06T20:55:00Z",
        evidence=PublicFirehoseEvidence(
            captured_at="2026-07-06T20:56:00Z",
            content_hash="sha256:kansas-city-heat-grant",
            passage=(
                "The foundation awarded neighborhood resilience grants for cooling centers "
                "and canvassing."
            ),
            published_at="2026-07-06T20:30:00Z",
            publisher="Heartland Civic Fund",
            source_class="grant_notice",
            source_url="https://kc.example/grants/heat-resilience",
            title="Heat resilience grant awards",
        ),
        id="fh_public_kansas_city_grant",
        issues=[PublicFirehoseIssue(label="Climate", slug="climate")],
        occurred_at="2026-07-06T20:30:00Z",
        places=[PublicFirehosePlace(label="Kansas City, MO", slug="kansas-city-mo")],
        public_realm_basis="Published grant notice",
        review_state="not_required",
        sensitivity=0.1,
        signal_type="grant_award",
        summary=(
            "A civic fund announced neighborhood grants for cooling centers and "
            "heat-safety canvassing."
        ),
        title="Civic fund awards heat resilience grants",
        visibility="public",
    ),
    PublicFirehoseSignal(
        confidence=0.41,
        detected_at="2026-07-06T20:10:00Z",
        evidence=PublicFirehoseEvidence(
            captured_at="2026-07-06T20:10:00Z",
            content_hash="sha256:held-person-signal",
            passage="A person-centered mention requires review before public routing.",
            published_at="2026-07-06T19:55:00Z",
            publisher="Example Source",
            source_class="news",
            source_url="https://example.test/held",
            title="Held update",
        ),
        id="fh_held_person_signal",
        issues=[PublicFirehoseIssue(label="Civic participation", slug="civic_participation")],
        occurred_at=None,
        places=[PublicFirehosePlace(label="Example, US", slug="example-us")],
        public_realm_basis="Review required",
        review_state="held",
        sensitivity=0.82,
        signal_type="new_source",
        summary="Held signal.",
        title="Held signal",
        visibility="reviewer",
    ),
)
