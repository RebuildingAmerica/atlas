"""Approval must fail safely when a staged public fact can no longer be trusted."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.source import SourceCRUD
from atlas.domains.moderation.review_queue import (
    ReviewConflictError,
    ReviewQueueCRUD,
    _reviewable_website_url,
)

_SOURCE_URL = "https://example.org/about"
_DESCRIPTION = {"description": {"before": "Published fact.", "after": "Proposed fact."}}


async def _stage(
    conn: Any,
    changes: dict[str, dict[str, Any]],
    *,
    kind: str = "organization",
    hold_reason: str = "published_profile_change",
) -> tuple[str, str]:
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Las Vegas Civic Group",
        description="Published fact.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
        active=True,
    )
    source_id = await SourceCRUD.create(
        conn,
        url=_SOURCE_URL,
        source_type="org_website",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(conn, entry_id, source_id)
    item_id = await ReviewQueueCRUD.enqueue(
        conn,
        entity_id=entry_id,
        kind=kind,
        hold_reason=hold_reason,
        score=None,
        dedup_suspect=False,
        dedup_note=None,
        proposed_changes=changes,
        source_urls=[_SOURCE_URL],
    )
    return entry_id, item_id


def test_malformed_https_port_is_not_presented_as_reviewable_website() -> None:
    assert _reviewable_website_url("https://example.org:invalid/about") is False


@pytest.mark.asyncio
async def test_second_approval_does_not_reapply_a_reviewed_change(test_db: Any) -> None:
    entry_id, item_id = await _stage(test_db, _DESCRIPTION)
    await ReviewQueueCRUD.approve(test_db, item_id, reviewed_by="first-editor")

    await ReviewQueueCRUD.approve(test_db, item_id, reviewed_by="second-editor")

    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    item = await ReviewQueueCRUD.get_by_id(test_db, item_id)
    assert entry is not None
    assert entry.description == "Proposed fact."
    assert item is not None
    assert item.reviewed_by == "first-editor"


@pytest.mark.asyncio
async def test_approval_refuses_a_profile_unpublished_after_staging(test_db: Any) -> None:
    entry_id, item_id = await _stage(test_db, _DESCRIPTION)
    await EntryCRUD.update(test_db, entry_id, active=False)

    with pytest.raises(ReviewConflictError, match="no longer available"):
        await ReviewQueueCRUD.approve(test_db, item_id, reviewed_by="editor")

    item = await ReviewQueueCRUD.get_by_id(test_db, item_id)
    assert item is not None
    assert item.status == "pending"


@pytest.mark.parametrize(
    ("changes", "kind", "hold_reason", "message"),
    [
        (_DESCRIPTION, "organization", "unrelated_hold", "unsupported fields"),
        (
            {"description": {"before": "Published fact."}},
            "organization",
            "published_profile_change",
            "unsupported fields",
        ),
        (
            {"issue_areas": {"before": ["housing_affordability"], "after": []}},
            "organization",
            "published_profile_change",
            "unsupported fields",
        ),
        (
            {
                "issue_areas": {
                    "before": ["housing_affordability"],
                    "after": ["housing_affordability"],
                }
            },
            "organization",
            "published_profile_change",
            "changed after",
        ),
        (
            {"description": {"before": "Older fact.", "after": "Proposed fact."}},
            "organization",
            "published_profile_change",
            "changed after",
        ),
        (
            {"website": {"before": None, "after": "https://new.example.org"}},
            "website_candidate",
            "published_profile_change",
            "unsupported fields",
        ),
    ],
)
@pytest.mark.asyncio
async def test_approval_rejects_invalid_or_stale_provenance(
    test_db: Any,
    changes: dict[str, dict[str, Any]],
    kind: str,
    hold_reason: str,
    message: str,
) -> None:
    entry_id, item_id = await _stage(test_db, changes, kind=kind, hold_reason=hold_reason)

    with pytest.raises(ReviewConflictError, match=message):
        await ReviewQueueCRUD.approve(test_db, item_id, reviewed_by="editor")

    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    item = await ReviewQueueCRUD.get_by_id(test_db, item_id)
    assert entry is not None
    assert entry.description == "Published fact."
    assert item is not None
    assert item.status == "pending"


class _ConcurrentChangeConnection:
    """Model the row disappearing between validation and guarded UPDATE."""

    async def execute(self, _query: str, _params: tuple[Any, ...]) -> SimpleNamespace:
        return SimpleNamespace(rowcount=0)


@pytest.mark.asyncio
async def test_text_update_detects_a_concurrent_profile_change() -> None:
    with pytest.raises(ReviewConflictError, match="changed after"):
        await ReviewQueueCRUD._write_staged_entry_fields(
            _ConcurrentChangeConnection(), "entry-id", _DESCRIPTION
        )


@pytest.mark.asyncio
async def test_issue_only_update_detects_a_concurrent_profile_removal() -> None:
    changes = {"issue_areas": {"before": [], "after": ["housing_affordability"]}}
    with pytest.raises(ReviewConflictError, match="changed after"):
        await ReviewQueueCRUD._write_staged_issues(
            _ConcurrentChangeConnection(), "entry-id", changes
        )
