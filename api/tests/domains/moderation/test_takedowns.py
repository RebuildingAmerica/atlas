"""A profile taken down stays down until an editor restores it."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.access.models.watch_events import OrgChangeEventCRUD, OrgChangeEventRecord
from atlas.domains.moderation.review_queue import TAKEN_DOWN_DETAIL, ReviewQueueCRUD
from atlas.domains.moderation.takedowns import EntryTakedownCRUD, TakedownConflictError
from atlas.models import EntryCRUD, SourceCRUD
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
    assert [(entry.actor_email, entry.allowed) for entry in entries] == [
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
async def test_a_second_takedown_inserts_nothing_even_without_the_early_check(
    test_db: object,
) -> None:
    """Two requests racing past each other still leave one standing takedown."""
    _, slug = await _profile(test_db)
    target = await EntryTakedownCRUD.find_target(test_db, slug)
    assert target is not None
    await EntryTakedownCRUD.take_down(
        test_db, target, reason=REASON, taken_down_by="editor@rebuildingus.org"
    )

    with pytest.raises(TakedownConflictError):
        await EntryTakedownCRUD.take_down(
            test_db, target, reason=REASON, taken_down_by="other@rebuildingus.org"
        )

    standing = await EntryTakedownCRUD.list_standing(test_db, limit=5)
    assert [item.taken_down_by for item in standing] == ["editor@rebuildingus.org"]


@pytest.mark.asyncio
async def test_a_taken_down_profile_leaves_follower_feeds_and_watch_digests(
    test_client: object, test_db: object, test_settings: object
) -> None:
    entry_id, slug = await _profile(test_db)
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/dana-profile",
        source_type="news_article",
        extraction_method="manual",
        title="Dana organizes tenants",
    )
    await test_db.execute(
        "INSERT INTO entry_sources (entry_id, source_id, created_at) VALUES (?, ?, ?)",
        (entry_id, source_id, "2026-10-08T00:00:00Z"),
    )
    await test_db.execute(
        "INSERT INTO org_watches (id, org_id, resource_type, resource_id, created_by)"
        " VALUES ('watch-1', 'org-1', 'entry', ?, 'user_follower')",
        (entry_id,),
    )
    await FollowCRUD.follow(test_db, user_id="user_follower", entry_id=entry_id)
    await OrgChangeEventCRUD.record(
        test_db,
        OrgChangeEventRecord(
            org_id="org-1",
            resource_type="entry",
            resource_id=entry_id,
            event_type="new_source",
            title="Dana Example has a new source",
            summary="Dana organizes tenants",
            source_id=source_id,
            entry_id=entry_id,
        ),
    )
    await test_db.commit()
    assert await FollowCRUD.feed_updates(test_db, "user_follower")
    assert await OrgChangeEventCRUD.list_digest(test_db, org_id="org-1", limit=10)
    headers = enable_staff_auth(test_settings)

    await test_client.post(
        "/api/takedowns", json={"slug": slug, "reason": REASON}, headers=headers.staff
    )

    assert await FollowCRUD.feed_updates(test_db, "user_follower") == []
    assert await OrgChangeEventCRUD.list_digest(test_db, org_id="org-1", limit=10) == []


@pytest.mark.asyncio
async def test_the_database_refuses_to_publish_a_taken_down_profile(test_db: object) -> None:
    """A publish path that forgets the check still cannot bring the profile back."""
    entry_id, slug = await _profile(test_db)
    target = await EntryTakedownCRUD.find_target(test_db, slug)
    assert target is not None
    await EntryTakedownCRUD.take_down(
        test_db, target, reason=REASON, taken_down_by="editor@rebuildingus.org"
    )

    with pytest.raises(Exception, match="entry is taken down"):
        await test_db.execute("UPDATE entries SET active = TRUE WHERE id = ?", (entry_id,))


@pytest.mark.asyncio
async def test_a_profile_is_found_only_by_its_current_address(test_db: object) -> None:
    """An editor names the profile they mean; an old address matches nothing."""
    entry_id, slug = await _profile(test_db)
    await test_db.execute("UPDATE entries SET slug = NULL WHERE id = ?", (entry_id,))
    await test_db.commit()

    assert await EntryTakedownCRUD.find_target(test_db, slug) is None
