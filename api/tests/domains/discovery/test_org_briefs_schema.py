"""Schema coverage for private workspace brief artifacts."""

# ruff: noqa

from __future__ import annotations

from tests.support.schema_introspection import table_columns

import pytest

from atlas.domains.discovery.briefs import (
    OrgBriefCRUD,
    StoredBriefDecodeError,
    _decode_json_object,
    _decode_json_object_list,
    _decode_json_string_list,
)

from tests.domains.discovery.org_briefs_support import ORG_ID


@pytest.mark.asyncio
async def test_init_db_creates_org_briefs_table(test_db: object) -> None:
    """Fresh databases should include durable workspace brief artifact columns."""
    columns = await table_columns(test_db, "org_briefs")

    assert {
        "id",
        "org_id",
        "title",
        "scope_json",
        "summary",
        "linked_entry_ids_json",
        "linked_source_ids_json",
        "linked_discovery_run_ids_json",
        "confidence_summary_json",
        "gaps_json",
        "created_by",
        "created_at",
        "updated_at",
    }.issubset(columns)


def test_stored_brief_decode_guards_reject_unexpected_shapes() -> None:
    """Corrupt persisted brief JSON should fail before it can become trusted output."""
    with pytest.raises(StoredBriefDecodeError):
        _decode_json_object('["not", "an", "object"]')

    with pytest.raises(StoredBriefDecodeError):
        _decode_json_string_list('["valid", 42]')

    with pytest.raises(StoredBriefDecodeError):
        _decode_json_object_list('[{"label": "ok"}, "not-object"]')


@pytest.mark.asyncio
async def test_update_returns_existing_brief_when_no_fields_are_sent(
    test_db: object,
) -> None:
    """Omitting every editable field should leave the stored brief untouched."""
    brief = await OrgBriefCRUD.create(
        test_db,
        org_id=ORG_ID,
        title="Kansas City housing landscape brief",
        scope={"geography": "Kansas City, MO"},
        summary="One source-backed housing lead is ready for review.",
        linked_entry_ids=[],
        linked_source_ids=[],
        linked_discovery_run_ids=[],
        confidence_summary={},
        gaps=[],
        created_by="local-user",
    )

    updated = await OrgBriefCRUD.update(test_db, brief.id)

    assert updated is not None
    assert updated.id == brief.id


@pytest.mark.asyncio
async def test_update_returns_none_for_missing_brief(test_db: object) -> None:
    """Missing briefs should stay missing during updates."""
    assert await OrgBriefCRUD.update(test_db, "missing-brief") is None


@pytest.mark.asyncio
async def test_update_returns_none_when_a_missing_brief_is_changed(
    test_db: object,
) -> None:
    """Updating a missing brief with fields should still fail cleanly."""
    assert (
        await OrgBriefCRUD.update(
            test_db,
            "missing-brief",
            title="Updated title",
        )
        is None
    )
