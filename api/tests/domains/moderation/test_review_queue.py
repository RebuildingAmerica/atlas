"""Tests for the pre-publication review queue table and CRUD."""
# ruff: noqa

from datetime import date

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD, _coerce_date
from atlas.models.database import get_db_connection


@pytest.mark.asyncio
async def test_review_queue_table_exists(db_url: str) -> None:
    """init_db must create the review_queue table with the expected columns."""
    conn = await get_db_connection(db_url)
    try:
        cursor = await conn.execute("PRAGMA table_info(review_queue)")
        rows = await cursor.fetchall()
    finally:
        await conn.close()

    columns = {row[1] for row in rows}
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
        )
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert item_id is not None
    assert [item.entity_id for item in pending] == [entity_id]
    assert pending[0].org_id == "org-a"
    assert pending[0].status == "pending"


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
    assert _coerce_date(None) is None
    assert _coerce_date("not-a-date") is None
    assert _coerce_date("2026-07-05T12:30:00Z") == date(2026, 7, 5)
