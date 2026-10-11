"""Editors can read what was done on their instance, and only that."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.platform.authz import Action, AuditLogCRUD, AuditRecord
from tests.support.staff_auth import enable_staff_auth


async def _record(test_db: object, action: Action, *, allowed: bool = True) -> str:
    return await AuditLogCRUD.record(
        test_db,
        AuditRecord(
            plane="customer",
            actor_id="user_editor",
            actor_email="editor@rebuildingus.org",
            auth_type="internal",
            action=action,
            allowed=allowed,
            status_code=HTTPStatus.OK if allowed else HTTPStatus.FORBIDDEN,
            method="POST",
            route="/api/review-queue/{item_id}/approve",
            target={"item_id": "review-1"},
            reason=None if allowed else "Editorial review requires Atlas staff.",
        ),
    )


@pytest.mark.asyncio
async def test_only_editors_can_read_editorial_activity(
    test_client: object, test_settings: object
) -> None:
    headers = enable_staff_auth(test_settings)

    response = await test_client.get("/api/audit-log", headers=headers.ordinary)

    assert response.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.asyncio
async def test_activity_pages_through_instance_decisions_newest_first(
    test_client: object, test_db: object, test_settings: object
) -> None:
    """Platform decisions are the platform admin's business and never appear here."""
    first = await _record(test_db, Action.REVIEW_QUEUE_DECIDE)
    await _record(test_db, Action.DISCOUNTS_REVIEW)
    second = await _record(test_db, Action.CLAIMS_REVIEW, allowed=False)
    third = await _record(test_db, Action.ENTRIES_TAKEDOWN)
    headers = enable_staff_auth(test_settings)

    page_one = await test_client.get("/api/audit-log?limit=2", headers=headers.staff)
    cursor = page_one.json()["next_before"]
    page_two = await test_client.get(
        "/api/audit-log", params={"limit": 2, "before": cursor}, headers=headers.staff
    )

    assert page_one.status_code == HTTPStatus.OK
    assert [item["id"] for item in page_one.json()["items"]] == [third, second]
    assert cursor is not None
    assert [item["id"] for item in page_two.json()["items"]] == [first]
    assert page_two.json()["next_before"] is None
    refused = page_one.json()["items"][1]
    assert (refused["allowed"], refused["reason"]) == (
        False,
        "Editorial review requires Atlas staff.",
    )
    assert refused["target"] == {"item_id": "review-1"}


@pytest.mark.asyncio
async def test_a_malformed_page_cursor_is_refused(
    test_client: object, test_settings: object
) -> None:
    headers = enable_staff_auth(test_settings)

    response = await test_client.get(
        "/api/audit-log", params={"before": "no-separator"}, headers=headers.staff
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["detail"] == "That page of activity does not exist."
