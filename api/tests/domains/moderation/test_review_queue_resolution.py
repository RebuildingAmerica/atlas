"""How resolution publishes and holds records without overruling a curator."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD


async def _entry(conn: object, *, active: bool = False) -> str:
    return str(
        await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Ana Ortiz",
            description="Listed as Chair of Food Bank on its IRS Form 990.",
            city="Lincoln",
            state="NE",
            geo_specificity="local",
            active=active,
        )
    )


async def _hold(conn: object, entity_id: str, reason: str) -> str:
    return str(
        await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="person",
            hold_reason=reason,
            score=None,
            dedup_suspect=reason == "dedup_suspect",
            dedup_note=None,
        )
    )


@pytest.mark.asyncio
async def test_release_publishes_and_closes_every_hold_resolution_can_decide(
    test_db: object,
) -> None:
    """A newer return that lists someone lifts the stale-role hold on them."""
    entity_id = await _entry(test_db)
    stale = await _hold(test_db, entity_id, "no_current_role")
    staleness = await _hold(test_db, entity_id, "stale_public_source_review")

    assert await ReviewQueueCRUD.release_resolved(test_db, entity_id=entity_id) is True

    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert entry.active is True
    released = await ReviewQueueCRUD.get_by_id(test_db, stale)
    assert released is not None
    assert (released.status, released.reviewed_by) == ("approved", "registry")
    untouched = await ReviewQueueCRUD.get_by_id(test_db, staleness)
    assert untouched is not None
    assert untouched.status == "pending"


@pytest.mark.asyncio
async def test_release_leaves_a_possible_duplicate_held(test_db: object) -> None:
    """Merging stays a reviewer's decision, whatever a return says."""
    entity_id = await _entry(test_db)
    await _hold(test_db, entity_id, "dedup_suspect")

    assert await ReviewQueueCRUD.release_resolved(test_db, entity_id=entity_id) is False

    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert entry.active is False


@pytest.mark.asyncio
async def test_release_does_not_reopen_a_rejected_record(test_db: object) -> None:
    """A curator's rejection outranks any later automated evidence."""
    entity_id = await _entry(test_db)
    item = await _hold(test_db, entity_id, "type_conflict")
    await ReviewQueueCRUD.reject(test_db, item, reviewed_by="curator@atlas")

    assert await ReviewQueueCRUD.release_resolved(test_db, entity_id=entity_id) is False

    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert entry.active is False


@pytest.mark.asyncio
async def test_a_hold_is_queued_once_per_entity_and_reason(test_db: object) -> None:
    """An ambiguous name a curator approved does not return on every run."""
    entity_id = await _entry(test_db, active=True)

    await ReviewQueueCRUD.hold_for_resolution(
        test_db, entity_id=entity_id, kind="person", hold_reason="identity_ambiguous"
    )
    [item] = await ReviewQueueCRUD.list_pending(test_db)
    await ReviewQueueCRUD.approve(test_db, item.id, reviewed_by="curator@atlas")
    await ReviewQueueCRUD.hold_for_resolution(
        test_db, entity_id=entity_id, kind="person", hold_reason="identity_ambiguous"
    )
    await ReviewQueueCRUD.hold_for_resolution(
        test_db, entity_id=entity_id, kind="person", hold_reason="no_current_role"
    )

    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert [p.hold_reason for p in pending] == ["no_current_role"]
    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert entry.active is True
