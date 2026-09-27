"""Tests for the pre-publication review queue table and CRUD."""

from tests.support.schema_introspection import table_columns
# ruff: noqa

from datetime import UTC, date, datetime

import pytest

from atlas.domains.catalog.schemas.public_review import ReviewQueueItemResponse
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.source import SourceCRUD
from atlas.domains.moderation.review_queue import ReviewConflictError, ReviewQueueCRUD, _row_to_item
from atlas.models.database import get_db_connection
from atlas.platform.dates import coerce_date


class _RecordingReviewQueueConnection:
    """Capture ReviewQueueCRUD.enqueue parameters without needing Postgres."""

    def __init__(self) -> None:
        self.params: tuple[object, ...] | None = None

    async def execute(self, _sql: str, params: tuple[object, ...]) -> object:
        self.params = params
        return object()

    async def commit(self) -> None:
        return None


@pytest.mark.asyncio
async def test_review_queue_table_exists(db_url: str) -> None:
    """init_db must create the review_queue table with the expected columns."""
    conn = await get_db_connection(db_url)
    try:
        rows = await table_columns(conn, "review_queue")
    finally:
        await conn.close()

    columns = rows
    assert columns >= {
        "id",
        "org_id",
        "entity_id",
        "kind",
        "status",
        "hold_reason",
        "score",
        "dedup_suspect",
        "created_at",
        "reviewed_at",
        "reviewed_by",
        "proposed_changes",
        "source_urls",
    }


@pytest.mark.asyncio
async def test_enqueue_and_list_pending(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Organizer",
            description="A community organizer.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            org_id="org-a",
            entity_id=entity_id,
            kind="person",
            hold_reason="person_requires_review",
            score=0.42,
            dedup_suspect=False,
            dedup_note=None,
            source_urls=["https://example.org/about"],
        )
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert item_id is not None
    assert [item.entity_id for item in pending] == [entity_id]
    assert pending[0].org_id == "org-a"
    assert pending[0].status == "pending"
    assert pending[0].entity_name == "Jane Organizer"
    assert pending[0].entity_type == "person"
    assert pending[0].source_urls == ["https://example.org/about"]


@pytest.mark.asyncio
async def test_enqueue_passes_boolean_dedup_suspect_parameter() -> None:
    """PostgreSQL expects dedup_suspect to be a bool, not a SQLite-style integer."""
    conn = _RecordingReviewQueueConnection()

    await ReviewQueueCRUD.enqueue(
        conn,
        entity_id="entry-1",
        kind="organization",
        hold_reason="dedup_suspect",
        score=0.7,
        dedup_suspect=True,
        dedup_note="Possible duplicate",
    )

    assert conn.params is not None
    assert conn.params[6] is True


def test_row_to_item_accepts_postgres_timestamp_values_for_api_response() -> None:
    """Postgres returns TIMESTAMPTZ columns as datetimes instead of SQLite-style strings."""
    item = _row_to_item(
        (
            "review-1",
            None,
            "entry-1",
            "organization",
            "pending",
            "uncorroborated_web_only",
            0.8,
            False,
            None,
            datetime(2026, 7, 12, 2, 41, tzinfo=UTC),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
    )

    response = ReviewQueueItemResponse.model_validate(item.__dict__)

    assert response.created_at == "2026-07-12T02:41:00+00:00"


@pytest.mark.asyncio
async def test_list_pending_can_filter_by_org_boundary(db_url: str) -> None:
    """Org-scoped moderation queues should not mix tenant-held records."""
    conn = await get_db_connection(db_url)
    try:
        await ReviewQueueCRUD.enqueue(
            conn,
            org_id="org-a",
            entity_id=None,
            kind="tenant_publish",
            hold_reason="source_required_for_public_directory",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
        )
        await ReviewQueueCRUD.enqueue(
            conn,
            org_id="org-b",
            entity_id=None,
            kind="tenant_publish",
            hold_reason="source_required_for_public_directory",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
        )
        pending = await ReviewQueueCRUD.list_pending(conn, org_id="org-a")
    finally:
        await conn.close()

    assert [item.org_id for item in pending] == ["org-a"]


@pytest.mark.asyncio
async def test_approve_marks_entry_active_and_item_approved(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Held Org",
            description="Held pending review.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=False,
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="uncorroborated_web_only",
            score=0.5,
            dedup_suspect=False,
            dedup_note=None,
        )
        await ReviewQueueCRUD.approve(conn, item_id, reviewed_by="curator@atlas")
        entry = await EntryCRUD.get_by_id(conn, entity_id)
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert entry is not None
    assert entry.active is True
    assert pending == []


@pytest.mark.asyncio
async def test_approve_applies_staged_public_change_and_reject_preserves_old_fact(
    db_url: str,
) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Reviewed Org",
            description="Original description.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=True,
            website="https://old.example",
            email="old@example.org",
            social_media={"bluesky": "old.handle"},
        )
        source_url = "https://example.org/new-work"
        source_id = await SourceCRUD.create(
            conn,
            url=source_url,
            source_type="org_website",
            extraction_method="manual",
        )
        await SourceCRUD.link_to_entry(conn, entity_id, source_id)
        proposal = {
            "description": {"before": "Original description.", "after": "New description."},
            "region": {"before": None, "after": "Kansas City metro"},
            "website": {"before": "https://old.example", "after": "https://new.example"},
            "email": {"before": "old@example.org", "after": "new@example.org"},
            "social_media": {
                "before": {"bluesky": "old.handle"},
                "after": {"bluesky": "new.handle"},
            },
            "issue_areas": {"before": [], "after": ["housing_affordability"]},
        }
        rejected_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="published_profile_change",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
            proposed_changes=proposal,
        )
        await ReviewQueueCRUD.reject(conn, rejected_id, reviewed_by="curator@atlas")
        after_reject = await EntryCRUD.get_by_id(conn, entity_id)
        assert after_reject is not None
        assert after_reject.description == "Original description."

        approved_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="published_profile_change",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
            proposed_changes=proposal,
            source_urls=[source_url],
        )
        await ReviewQueueCRUD.approve(conn, approved_id, reviewed_by="curator@atlas")
        after_approve = await EntryCRUD.get_by_id(conn, entity_id)
        approved = await ReviewQueueCRUD.get_by_id(conn, approved_id)
        cursor = await conn.execute(
            "SELECT issue_area FROM entry_issue_areas WHERE entry_id = ?", (entity_id,)
        )
        approved_issues = [row[0] for row in await cursor.fetchall()]
    finally:
        await conn.close()

    assert after_approve is not None
    assert after_approve.description == "New description."
    assert after_approve.region == "Kansas City metro"
    assert after_approve.website == "https://new.example"
    assert after_approve.email == "new@example.org"
    assert after_approve.social_media == {"bluesky": "new.handle"}
    assert approved is not None
    assert approved.status == "approved"
    assert approved.proposed_changes == proposal
    assert approved_issues == ["housing_affordability"]


@pytest.mark.asyncio
async def test_approval_refuses_stale_proposal_without_closing_review(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Changing Org",
            description="Original.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=True,
        )
        proposal = {"description": {"before": "Original.", "after": "Proposed."}}
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="published_profile_change",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
            proposed_changes=proposal,
        )
        await EntryCRUD.update(conn, entity_id, description="Curator edited this.")
        with pytest.raises(ReviewConflictError):
            await ReviewQueueCRUD.approve(conn, item_id, reviewed_by="curator@atlas")
        stored = await EntryCRUD.get_by_id(conn, entity_id)
        review = await ReviewQueueCRUD.get_by_id(conn, item_id)
    finally:
        await conn.close()

    assert stored is not None
    assert stored.description == "Curator edited this."
    assert review is not None
    assert review.status == "pending"


@pytest.mark.asyncio
async def test_reject_keeps_entry_inactive(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Bad Org",
            description="Rejected.",
            city="KC",
            state="MO",
            geo_specificity="local",
            active=False,
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="uncorroborated_web_only",
            score=0.1,
            dedup_suspect=False,
            dedup_note=None,
        )
        await ReviewQueueCRUD.reject(conn, item_id, reviewed_by="curator@atlas")
        entry = await EntryCRUD.get_by_id(conn, entity_id)
    finally:
        await conn.close()

    assert entry is not None
    assert entry.active is False


@pytest.mark.asyncio
async def test_approve_unknown_item_is_a_no_op_close(db_url: str) -> None:
    """Approving a missing item closes nothing and never touches an entry."""
    conn = await get_db_connection(db_url)
    try:
        await ReviewQueueCRUD.approve(conn, "no-such-item", reviewed_by="curator@atlas")
        item = await ReviewQueueCRUD.get_by_id(conn, "no-such-item")
    finally:
        await conn.close()

    assert item is None


@pytest.mark.asyncio
async def test_approve_item_without_entity_just_closes(db_url: str) -> None:
    """A held item whose entity_id is null is closed without an entries update."""
    conn = await get_db_connection(db_url)
    try:
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=None,
            kind="organization",
            hold_reason="uncorroborated_web_only",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
        )
        await ReviewQueueCRUD.approve(conn, item_id, reviewed_by="curator@atlas")
        item = await ReviewQueueCRUD.get_by_id(conn, item_id)
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert item is not None
    assert item.status == "approved"
    assert item.reviewed_by == "curator@atlas"
    assert pending == []


@pytest.mark.asyncio
async def test_count_pending_tracks_open_items(db_url: str) -> None:
    """count_pending reflects only items still awaiting review."""
    conn = await get_db_connection(db_url)
    try:
        empty = await ReviewQueueCRUD.count_pending(conn)
        first = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=None,
            kind="person",
            hold_reason="person_requires_review",
            score=0.3,
            dedup_suspect=False,
            dedup_note=None,
        )
        await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=None,
            kind="person",
            hold_reason="person_requires_review",
            score=0.4,
            dedup_suspect=False,
            dedup_note=None,
        )
        after_two = await ReviewQueueCRUD.count_pending(conn)
        await ReviewQueueCRUD.reject(conn, first, reviewed_by="curator@atlas")
        after_one_closed = await ReviewQueueCRUD.count_pending(conn)
    finally:
        await conn.close()

    assert empty == 0
    assert after_two == 2  # noqa: PLR2004
    assert after_one_closed == 1


def test_coerce_date_handles_missing_and_invalid_values() -> None:
    """Review queue timestamps should parse conservatively."""
    assert coerce_date(None) is None
    assert coerce_date("not-a-date") is None
    assert coerce_date("2026-07-05T12:30:00Z") == date(2026, 7, 5)
