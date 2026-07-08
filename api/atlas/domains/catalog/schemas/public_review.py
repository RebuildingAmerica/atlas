"""Public moderation review queue schema models."""

from __future__ import annotations

from pydantic import BaseModel, Field


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
