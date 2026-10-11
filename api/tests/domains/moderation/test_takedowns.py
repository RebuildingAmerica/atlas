"""A profile taken down stays down until an editor restores it."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.moderation.review_queue import TAKEN_DOWN_DETAIL, ReviewQueueCRUD
from atlas.domains.moderation.takedowns import EntryTakedownCRUD
from atlas.models import EntryCRUD
from atlas.platform.authz import Action, AuditLogCRUD
from tests.support.staff_auth import enable_staff_auth

REASON = "The person asked to be removed by email on 2026-10-08."


async def _profile(test_db: object, *, active: bool = True) -> tuple[str, str]:
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Dana Example",
        description="A local organizer who asked to be removed.",
        city="Reno",
        state="NV",
        geo_specificity="local",
        active=active,
    )
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.slug is not None
    return entry_id, entry.slug


@pytest.mark.asyncio
async def test_only_editors_can_take_profiles_down(
    test_client: object, test_db: object, test_settings: object
) -> None:
    _, slug = await _profile(test_db)
    headers = enable_staff_auth(test_settings)

    listed = await test_client.get("/api/takedowns", headers=headers.ordinary)
    created = await test_client.post(
        "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.ordinary
    )
    restored = await test_client.post("/api/takedowns/any/restore", headers=headers.ordinary)

    assert {listed.status_code, created.status_code, restored.status_code} == {HTTPStatus.FORBIDDEN}


@pytest.mark.asyncio
async def test_taking_a_profile_down_hides_it_and_records_why(
    test_client: object, test_db: object, test_settings: object
) -> None:
    entry_id, slug = await _profile(test_db)
    headers = enable_staff_auth(test_settings)

    response = await test_client.post(
        "/api/takedowns", json={"slug": f" {slug} ", "reason": f" {REASON} "}, headers=headers.staff
    )

    assert response.status_code == HTTPStatus.CREATED
    body = response.json()
    assert (body["entry_id"], body["reason"], body["was_active"]) == (entry_id, REASON, True)
    assert body["taken_down_by"] == "editor@rebuildingus.org"
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.active is False
    listed = await test_client.get("/api/takedowns", headers=headers.staff)
    assert [item["id"] for item in listed.json()["items"]] == [body["id"]]
    entries = await AuditLogCRUD.list_recent(test_db, limit=5, action=Action.ENTRIES_TAKEDOWN)
    assert [((entry.actor_email or "").lower(), entry.allowed) for entry in entries] == [
        ("editor@rebuildingus.org", True)
    ]


@pytest.mark.asyncio
async def test_a_profile_cannot_come_down_twice_or_without_an_address(
    test_client: object, test_db: object, test_settings: object
) -> None:
    _, slug = await _profile(test_db)
    headers = enable_staff_auth(test_settings)
    await test_client.post(
        "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.staff
    )

    again = await test_client.post(
        "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.staff
    )
    missing = await test_client.post(
        "/api/takedowns", json={"slug": "nobody-here", "reason": REASON}, headers=headers.staff
    )

    assert again.status_code == HTTPStatus.CONFLICT
    assert again.json()["detail"] == "This profile is already taken down."
    assert missing.status_code == HTTPStatus.NOT_FOUND


@pytest.mark.asyncio
async def test_nothing_republishes_a_profile_while_it_is_down(
    test_client: object, test_db: object, test_settings: object
) -> None:
    """An editor's approval and a later registry match both leave it hidden."""
    entry_id, slug = await _profile(test_db, active=False)
    item_id = await ReviewQueueCRUD.enqueue(
        test_db,
        entity_id=entry_id,
        kind="person",
        hold_reason="stale_return",
        score=0.9,
        dedup_suspect=False,
        dedup_note=None,
    )
    headers = enable_staff_auth(test_settings)
    await test_client.post(
        "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.staff
    )

    approved = await test_client.post(f"/api/review-queue/{item_id}/approve", headers=headers.staff)
    released = await ReviewQueueCRUD.release_resolved(test_db, entity_id=entry_id)

    assert approved.status_code == HTTPStatus.CONFLICT
    assert approved.json()["detail"] == TAKEN_DOWN_DETAIL
    assert released is False
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.active is False


@pytest.mark.asyncio
async def test_restoring_puts_a_profile_back_the_way_it_was(
    test_client: object, test_db: object, test_settings: object
) -> None:
    published_id, published_slug = await _profile(test_db)
    held_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Held Group",
        description="Still waiting for review when it came down.",
        city="Reno",
        state="NV",
        geo_specificity="local",
        active=False,
    )
    held = await EntryCRUD.get_by_id(test_db, held_id)
    assert held is not None
    headers = enable_staff_auth(test_settings)
    takedowns = [
        (
            await test_client.post(
                "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.staff
            )
        ).json()["id"]
        for slug in (published_slug, held.slug)
    ]

    for takedown_id in takedowns:
        restored = await test_client.post(
            f"/api/takedowns/{takedown_id}/restore", headers=headers.staff
        )
        assert restored.status_code == HTTPStatus.OK
        assert restored.json()["restored_by"] == "editor@rebuildingus.org"

    published = await EntryCRUD.get_by_id(test_db, published_id)
    held_after = await EntryCRUD.get_by_id(test_db, held_id)
    assert published is not None
    assert held_after is not None
    assert (published.active, held_after.active) == (True, False)
    assert await EntryTakedownCRUD.is_taken_down(test_db, published_id) is False
    listed = await test_client.get("/api/takedowns", headers=headers.staff)
    assert listed.json()["items"] == []


@pytest.mark.asyncio
async def test_a_lifted_or_unknown_takedown_cannot_be_restored(
    test_client: object, test_db: object, test_settings: object
) -> None:
    _, slug = await _profile(test_db)
    headers = enable_staff_auth(test_settings)
    takedown_id = (
        await test_client.post(
            "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.staff
        )
    ).json()["id"]
    await test_client.post(f"/api/takedowns/{takedown_id}/restore", headers=headers.staff)

    again = await test_client.post(f"/api/takedowns/{takedown_id}/restore", headers=headers.staff)
    unknown = await test_client.post("/api/takedowns/unknown/restore", headers=headers.staff)

    assert again.status_code == HTTPStatus.CONFLICT
    assert again.json()["detail"] == "This takedown was already lifted."
    assert unknown.status_code == HTTPStatus.NOT_FOUND


@pytest.mark.asyncio
async def test_a_profile_is_found_only_by_its_current_address(test_db: object) -> None:
    """An editor names the profile they mean; an old address matches nothing."""
    entry_id, slug = await _profile(test_db)
    await test_db.execute("UPDATE entries SET slug = NULL WHERE id = ?", (entry_id,))
    await test_db.commit()

    assert await EntryTakedownCRUD.find_target(test_db, slug) is None
