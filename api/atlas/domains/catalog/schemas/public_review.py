"""Public moderation review queue schema models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ReviewSourceEvidenceResponse(BaseModel):
    """One cited URL and its recorded claim context."""

    url: str
    context: str


class ReviewQueueItemResponse(BaseModel):
    """A publication hold or proposed public-profile change for review."""

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
    proposed_changes: dict[str, dict[str, Any]] | None = None
    source_urls: list[str] = Field(default_factory=list)
    source_evidence: list[ReviewSourceEvidenceResponse] = Field(default_factory=list)
    entity_name: str | None = None
    entity_slug: str | None = None
    entity_type: str | None = None
    entity_description: str | None = None
    entity_city: str | None = None
    entity_state: str | None = None
    entity_website: str | None = None
    entity_issue_areas: list[str] = Field(default_factory=list)


class ReviewQueueListResponse(BaseModel):
    """Pending review-queue collection."""

    items: list[ReviewQueueItemResponse] = Field(default_factory=list)
    total: int
