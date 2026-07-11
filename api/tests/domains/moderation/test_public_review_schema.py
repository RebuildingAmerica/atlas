"""Schema tests for public moderation review responses."""

from atlas.domains.catalog.schemas.public_review import (
    ReviewQueueItemResponse,
    ReviewQueueListResponse,
)


def test_public_review_queue_schema_defaults_items() -> None:
    """Review queue collections should default to an empty item list."""
    payload = ReviewQueueListResponse(total=0)

    assert payload.items == []
    assert payload.total == 0


def test_public_review_queue_item_serializes_nullable_review_fields() -> None:
    """Pending review items should preserve nullable entity and review fields."""
    item = ReviewQueueItemResponse(
        id="review_1",
        kind="entry",
        status="pending",
        hold_reason="needs_source_review",
        dedup_suspect=False,
        created_at="2026-07-10T12:00:00Z",
    )

    assert item.model_dump() == {
        "id": "review_1",
        "org_id": None,
        "entity_id": None,
        "kind": "entry",
        "status": "pending",
        "hold_reason": "needs_source_review",
        "score": None,
        "dedup_suspect": False,
        "dedup_note": None,
        "created_at": "2026-07-10T12:00:00Z",
        "reviewed_at": None,
        "reviewed_by": None,
    }
