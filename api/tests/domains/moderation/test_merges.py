"""Merging a duplicate profile folds it into the one to keep, and it stays folded."""

from __future__ import annotations

import sqlite3
from http import HTTPStatus
from typing import Any

import pytest
from atlas_shared import DeduplicatedEntry as SharedDeduplicatedEntry

from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.discovery.pipeline.runner_storage_persistence import _find_existing_entry
from atlas.domains.moderation import merges as merges_module
from atlas.domains.moderation.merges import (
    BOTH_LINKED_BLOCKER,
    DIFFERENT_KINDS_BLOCKER,
    SAME_PROFILE_BLOCKER,
    EntryMergeCRUD,
    MergeBlockedError,
)
from atlas.domains.moderation.models import FlagCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.domains.moderation.takedowns import EntryTakedownCRUD, TakedownTarget
from atlas.models import EntryCRUD, SourceCRUD
from atlas.platform.authz import Action, AuditLogCRUD
from tests.support.staff_auth import enable_staff_auth

REASON = "Same EIN on both state filings."


async def _org(
    conn: Any, name: str, *, entry_type: str = "organization", active: bool = True
) -> TakedownTarget:
    entry_id = await EntryCRUD.create(
        conn,
        entry_type=entry_type,
        name=name,
        description=f"{name} organizes renters.",
        city="Reno",
        state="NV",
        geo_specificity="local",
        active=active,
    )
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None
    assert entry.slug is not None
    target = await EntryTakedownCRUD.find_target(conn, entry.slug)
    assert target is not None
    return target


async def _source(conn: Any, url: str, *entries: str) -> str:
    source_id = await SourceCRUD.create(conn, url, "org_website", "manual")
    for entry_id in entries:
        await SourceCRUD.link_to_entry(conn, entry_id, source_id)
    return source_id


async def _rows(conn: Any, sql: str, params: tuple[str, ...]) -> list[tuple[Any, ...]]:
    cursor = await conn.execute(sql, params)
    return [tuple(row) for row in await cursor.fetchall()]


async def _seed_duplicate_pair(conn: Any) -> dict[str, Any]:
    """Two listings of one union, with every kind of row a merge moves."""
    keep = await _org(conn, "Reno Tenants Union")
    duplicate = await _org(conn, "Reno Tenants")
    other = await _org(conn, "Washoe Housing Coalition")
    parent_of_both = await _org(conn, "Nevada Renters Network")
    shared = await _source(conn, "https://example.org/shared", keep.id, duplicate.id)
    only_duplicate = await _source(conn, "https://example.org/filing", duplicate.id)
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES"
        " (?, 'housing_affordability', '2026-10-01'), (?, 'housing_affordability', '2026-10-01'),"
        " (?, 'tenant_rights', '2026-10-01')",
        (keep.id, duplicate.id, duplicate.id),
    )
    await FollowCRUD.follow(conn, user_id="user-both", entry_id=keep.id)
    await FollowCRUD.follow(conn, user_id="user-both", entry_id=duplicate.id)
    await FollowCRUD.follow(conn, user_id="user-dup", entry_id=duplicate.id)
    both_list = await SavedListCRUD.create(conn, user_id="user-both", name="Housing")
    dup_list = await SavedListCRUD.create(conn, user_id="user-dup", name="Reno")
    await SavedListCRUD.add_item(conn, list_id=both_list.id, entry_id=keep.id)
    await SavedListCRUD.add_item(conn, list_id=both_list.id, entry_id=duplicate.id)
    await SavedListCRUD.add_item(conn, list_id=dup_list.id, entry_id=duplicate.id)
    for source_entry, target_entry in (
        (duplicate.id, other.id),  # moves
        (duplicate.id, keep.id),  # between the two: dropped
        (parent_of_both.id, duplicate.id),  # repeats parent -> keep: dropped
        (parent_of_both.id, keep.id),
    ):
        await RelationshipCRUD.upsert_edge(
            conn,
            source_entry_id=source_entry,
            target_entry_id=target_entry,
            relationship_type="partner_of",
            source_id=shared,
            evidence_label="Listed as partners",
            confidence=0.8,
        )
    await RelationshipCRUD.upsert_identity_key(
        conn,
        entry_id=duplicate.id,
        key_type="ein",
        key_value="88-1234567",
        source_id=only_duplicate,
        confidence=0.9,
    )
    open_flag = await FlagCRUD.create_entity_flag(
        conn, entity_id=duplicate.id, reason="incorrect_info", note="Old phone number."
    )
    closed_flag = await FlagCRUD.create_entity_flag(
        conn, entity_id=duplicate.id, reason="incorrect_info"
    )
    await conn.execute(
        "UPDATE entity_flags SET status = 'resolved' WHERE id = ?", (closed_flag.id,)
    )
    review_id = await ReviewQueueCRUD.enqueue(
        conn,
        entity_id=duplicate.id,
        kind="organization",
        hold_reason="low_confidence",
        score=0.4,
        dedup_suspect=False,
        dedup_note=None,
    )
    member = await _org(conn, "Dana Example", entry_type="person")
    await conn.execute(
        "UPDATE entries SET affiliated_org_id = ? WHERE id IN (?, ?)",
        (duplicate.id, member.id, keep.id),
    )
    await conn.execute(
        "INSERT INTO outreach_logs (id, entry_id, date, method, created_at)"
        " VALUES ('outreach-1', ?, '2026-10-01', 'email', '2026-10-01')",
        (duplicate.id,),
    )
    await conn.execute(
        "INSERT INTO org_annotations (id, org_id, entry_id, target_type, target_id, content,"
        " author_id) VALUES ('note-1', 'org-1', ?, 'entry', ?, 'Met at the hearing.', 'u1')",
        (duplicate.id, duplicate.id),
    )
    await conn.execute(
        "INSERT INTO atproto_identities (id, did, current_handle, created_at, updated_at)"
        " VALUES ('identity-1', 'did:plc:reno', 'renotenants.org', '2026-10-01', '2026-10-01')"
    )
    await conn.execute(
        "INSERT INTO profile_atproto_links (id, entry_id, identity_id, status, created_at,"
        " updated_at) VALUES ('link-1', ?, 'identity-1', 'verified', '2026-10-01', '2026-10-01')",
        (duplicate.id,),
    )
    await conn.execute(
        "INSERT INTO slug_aliases (old_slug, entry_id) VALUES ('reno-tenants-old', ?)",
        (duplicate.id,),
    )
    await conn.commit()
    return {
        "keep": keep,
        "duplicate": duplicate,
        "other": other,
        "member": member,
        "only_duplicate_source": only_duplicate,
        "open_flag": open_flag.id,
        "closed_flag": closed_flag.id,
        "review_id": review_id,
    }


EXPECTED_MOVES = {
    "sources": 1,
    "issue_areas": 1,
    "connections": 1,
    "followers": 1,
    "saved_list_places": 1,
    "open_reports": 1,
    "identity_keys": 1,
    "pending_reviews": 1,
}


@pytest.mark.asyncio
async def test_only_editors_can_merge(test_client: Any, test_db: Any, test_settings: Any) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    duplicate = await _org(test_db, "Reno Tenants")
    headers = enable_staff_auth(test_settings)
    query = {"keep": keep.slug, "duplicate": duplicate.slug}

    listed = await test_client.get("/api/merges", headers=headers.ordinary)
    previewed = await test_client.get("/api/merges/preview", params=query, headers=headers.ordinary)
    merged = await test_client.post(
        "/api/merges", json={**query, "reason": REASON}, headers=headers.ordinary
    )

    assert {listed.status_code, previewed.status_code, merged.status_code} == {HTTPStatus.FORBIDDEN}


@pytest.mark.asyncio
async def test_checking_a_merge_counts_what_moves_and_changes_nothing(
    test_client: Any, test_db: Any, test_settings: Any
) -> None:
    seeded = await _seed_duplicate_pair(test_db)
    headers = enable_staff_auth(test_settings)

    response = await test_client.get(
        "/api/merges/preview",
        params={"keep": seeded["keep"].slug, "duplicate": f" {seeded['duplicate'].slug} "},
        headers=headers.staff,
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["blockers"] == []
    assert body["moves"] == EXPECTED_MOVES
    assert body["keep"]["name"] == "Reno Tenants Union"
    assert body["duplicate"] == {
        "id": seeded["duplicate"].id,
        "name": "Reno Tenants",
        "slug": seeded["duplicate"].slug,
        "type": "organization",
        "active": True,
    }
    unchanged = await EntryCRUD.get_by_id(test_db, seeded["duplicate"].id)
    assert unchanged is not None
    assert unchanged.active is True
    assert await AuditLogCRUD.list_recent(test_db, limit=5) == []


@pytest.mark.asyncio
async def test_merging_moves_everything_and_retires_the_duplicate(
    test_client: Any, test_db: Any, test_settings: Any
) -> None:
    seeded = await _seed_duplicate_pair(test_db)
    keep, duplicate = seeded["keep"], seeded["duplicate"]
    headers = enable_staff_auth(test_settings)

    response = await test_client.post(
        "/api/merges",
        json={"keep": keep.slug, "duplicate": duplicate.slug, "reason": f" {REASON} "},
        headers=headers.staff,
    )

    assert response.status_code == HTTPStatus.CREATED, response.text
    body = response.json()
    assert body["moved"] == EXPECTED_MOVES
    assert (body["kept_entry_id"], body["duplicate_entry_id"]) == (keep.id, duplicate.id)
    assert (body["reason"], body["merged_by"]) == (REASON, "editor@rebuildingus.org")
    retired = await EntryCRUD.get_by_id(test_db, duplicate.id)
    assert retired is not None
    assert retired.active is False

    for sql in (
        "SELECT entry_id FROM entry_sources WHERE entry_id = ?",
        "SELECT entry_id FROM entry_issue_areas WHERE entry_id = ?",
        "SELECT entry_id FROM profile_follows WHERE entry_id = ?",
        "SELECT entry_id FROM saved_list_items WHERE entry_id = ?",
        "SELECT entry_id FROM entity_identity_keys WHERE entry_id = ?",
        "SELECT source_entry_id FROM entity_relationship_edges"
        " WHERE source_entry_id = ?1 OR target_entry_id = ?1",
        "SELECT entry_id FROM outreach_logs WHERE entry_id = ?",
        "SELECT entry_id FROM org_annotations WHERE entry_id = ?1 OR target_id = ?1",
    ):
        assert await _rows(test_db, sql, (duplicate.id,)) == [], sql
    assert (
        len(await _rows(test_db, "SELECT 1 FROM entry_sources WHERE entry_id = ?", (keep.id,))) == 2
    )  # noqa: PLR2004
    assert await _rows(
        test_db,
        "SELECT user_id FROM profile_follows WHERE entry_id = ? ORDER BY user_id",
        (keep.id,),
    ) == [("user-both",), ("user-dup",)]
    assert await _rows(
        test_db,
        "SELECT target_entry_id FROM entity_relationship_edges WHERE source_entry_id = ?",
        (keep.id,),
    ) == [(seeded["other"].id,)]
    assert await _rows(
        test_db,
        "SELECT entity_id FROM entity_flags WHERE id IN (?, ?) ORDER BY status",
        (seeded["open_flag"], seeded["closed_flag"]),
    ) == [(keep.id,), (duplicate.id,)]
    assert await _rows(
        test_db, "SELECT status, reviewed_by FROM review_queue WHERE id = ?", (seeded["review_id"],)
    ) == [("rejected", "editor@rebuildingus.org")]
    assert await _rows(
        test_db, "SELECT entry_id FROM profile_atproto_links WHERE id = 'link-1'", ()
    ) == [(keep.id,)]
    assert await _rows(
        test_db,
        "SELECT id, affiliated_org_id FROM entries WHERE id IN (?, ?) ORDER BY name",
        (seeded["member"].id, keep.id),
    ) == [(seeded["member"].id, keep.id), (keep.id, None)]

    # Both the duplicate's address and its older alias open the kept profile.
    for old_slug in (duplicate.slug, "reno-tenants-old"):
        redirected = await test_client.get(
            f"/api/entities/by-slug/organizations/{old_slug}", follow_redirects=False
        )
        assert redirected.status_code == HTTPStatus.MOVED_PERMANENTLY
        assert redirected.headers["location"].endswith(f"/{keep.slug}")

    [entry] = await AuditLogCRUD.list_recent(test_db, limit=5, action=Action.ENTRIES_MERGE)
    assert entry.reason == REASON
    listed = await test_client.get("/api/merges", headers=headers.staff)
    assert [item["id"] for item in listed.json()["items"]] == [body["id"]]


@pytest.mark.asyncio
async def test_a_merged_duplicate_stays_retired_and_its_name_finds_the_kept_profile(
    test_db: Any,
) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    duplicate = await _org(test_db, "Reno Tenants")
    await EntryMergeCRUD.merge(test_db, keep, duplicate, reason=REASON, merged_by="editor")

    with pytest.raises(sqlite3.IntegrityError, match="merged into another profile"):
        await test_db.execute("UPDATE entries SET active = TRUE WHERE id = ?", (duplicate.id,))
    await test_db.rollback()

    found = await _find_existing_entry(
        test_db,
        SharedDeduplicatedEntry(
            name="Reno Tenants", entry_type="organization", city="Reno", state="NV"
        ),
    )
    assert found is not None
    assert found.id == keep.id
    unmerged = await _find_existing_entry(
        test_db,
        SharedDeduplicatedEntry(
            name="Reno Tenants Union", entry_type="organization", city="Reno", state="NV"
        ),
    )
    assert unmerged is not None
    assert unmerged.id == keep.id


@pytest.mark.asyncio
async def test_merges_of_merges_resolve_to_the_profile_that_stands(test_db: Any) -> None:
    first = await _org(test_db, "Reno Tenants")
    second = await _org(test_db, "Reno Tenants Union")
    third = await _org(test_db, "Northern Nevada Tenants Union")
    await EntryMergeCRUD.merge(test_db, second, first, reason=REASON, merged_by="editor")
    merge = await EntryMergeCRUD.merge(test_db, third, second, reason=REASON, merged_by="editor")

    assert await EntryMergeCRUD.surviving_entry_id(test_db, first.id) == third.id
    assert await EntryMergeCRUD.surviving_entry_id(test_db, third.id) is None
    assert merge.moved.sources == 0
    assert [item.id for item in await EntryMergeCRUD.list_recent(test_db, limit=1)] == [merge.id]
    # The first duplicate's address followed its profile to the one that stands.
    assert await _rows(
        test_db, "SELECT entry_id FROM slug_aliases WHERE old_slug = ?", (str(first.slug),)
    ) == [(third.id,)]


@pytest.mark.asyncio
async def test_a_profile_without_a_slug_merges_without_an_alias(test_db: Any) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    duplicate = await _org(test_db, "Reno Tenants")
    unaddressed = TakedownTarget(
        id=duplicate.id, name=duplicate.name, slug=None, type=duplicate.type, active=True
    )

    merge = await EntryMergeCRUD.merge(test_db, keep, unaddressed, reason=REASON, merged_by="e")

    assert merge.duplicate_slug is None
    assert await _rows(test_db, "SELECT 1 FROM slug_aliases WHERE entry_id = ?", (keep.id,)) == []


@pytest.mark.asyncio
async def test_blocked_merges_say_why_and_change_nothing(
    test_client: Any, test_db: Any, test_settings: Any
) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    duplicate = await _org(test_db, "Reno Tenants")
    person = await _org(test_db, "Dana Example", entry_type="person")
    headers = enable_staff_auth(test_settings)

    same = await test_client.get(
        "/api/merges/preview",
        params={"keep": keep.slug, "duplicate": keep.slug},
        headers=headers.staff,
    )
    assert same.json()["blockers"] == [SAME_PROFILE_BLOCKER]

    await EntryTakedownCRUD.take_down(test_db, duplicate, reason="Asked.", taken_down_by="e")
    await test_db.execute(
        "INSERT INTO resource_ownership (resource_id, resource_type, org_id, created_by,"
        " visibility) VALUES (?, 'entry', 'org-1', 'u1', 'private')",
        (person.id,),
    )
    await test_db.execute(
        "INSERT INTO profile_claims (id, entry_id, user_id, user_email, created_at, updated_at)"
        " VALUES ('claim-1', ?, 'u2', 'rep@example.org', '2026-10-01', '2026-10-01')",
        (person.id,),
    )
    await test_db.execute(
        "INSERT INTO atproto_identities (id, did, current_handle, created_at, updated_at) VALUES"
        " ('id-a', 'did:plc:a', 'a.example', '2026-10-01', '2026-10-01'),"
        " ('id-b', 'did:plc:b', 'b.example', '2026-10-01', '2026-10-01')"
    )
    await test_db.execute(
        "INSERT INTO profile_atproto_links (id, entry_id, identity_id, status, created_at,"
        " updated_at) VALUES ('l-a', ?, 'id-a', 'verified', '2026-10-01', '2026-10-01'),"
        " ('l-b', ?, 'id-b', 'verified', '2026-10-01', '2026-10-01')",
        (keep.id, person.id),
    )
    await test_db.commit()

    previewed = await test_client.get(
        "/api/merges/preview",
        params={"keep": keep.slug, "duplicate": person.slug},
        headers=headers.staff,
    )
    assert previewed.json()["blockers"] == [
        DIFFERENT_KINDS_BLOCKER,
        "Dana Example belongs to a workspace, not the public catalog.",
        "Dana Example has a representative or a verification waiting."
        " Merge the other way so they keep their profile.",
        BOTH_LINKED_BLOCKER,
    ]
    refused = await test_client.post(
        "/api/merges",
        json={"keep": keep.slug, "duplicate": duplicate.slug, "reason": REASON},
        headers=headers.staff,
    )
    assert refused.status_code == HTTPStatus.CONFLICT
    assert refused.json()["detail"] == "Reno Tenants is taken down. Restore it before merging."
    assert await EntryMergeCRUD.list_recent(test_db, limit=5) == []


@pytest.mark.asyncio
async def test_a_profile_merged_away_can_be_neither_kept_nor_merged_again(
    test_db: Any,
) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    duplicate = await _org(test_db, "Reno Tenants")
    other = await _org(test_db, "Washoe Tenants")
    await EntryMergeCRUD.merge(test_db, keep, duplicate, reason=REASON, merged_by="e")

    as_keep = await EntryMergeCRUD.plan(test_db, duplicate, other)
    with pytest.raises(MergeBlockedError, match="Reno Tenants was already merged"):
        await EntryMergeCRUD.merge(test_db, other, duplicate, reason=REASON, merged_by="e")

    assert as_keep.blockers == ("Reno Tenants was already merged into another profile.",)


@pytest.mark.asyncio
async def test_a_merge_that_loses_a_race_moves_nothing(
    test_db: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    duplicate = await _org(test_db, "Reno Tenants")
    other = await _org(test_db, "Washoe Tenants")
    source = await _source(test_db, "https://example.org/filing", duplicate.id)
    await EntryMergeCRUD.merge(test_db, keep, duplicate, reason=REASON, merged_by="e")
    await SourceCRUD.link_to_entry(test_db, duplicate.id, source)

    async def no_blockers(*_args: object) -> tuple[str, ...]:
        return ()

    # A second request that checked before the first merge committed.
    monkeypatch.setattr(merges_module, "_blockers", no_blockers)
    with pytest.raises(MergeBlockedError, match="already merged"):
        await EntryMergeCRUD.merge(test_db, other, duplicate, reason=REASON, merged_by="e")

    assert await _rows(
        test_db, "SELECT source_id FROM entry_sources WHERE entry_id = ?", (duplicate.id,)
    ) == [(source,)]
    assert len(await EntryMergeCRUD.list_recent(test_db, limit=5)) == 1


@pytest.mark.asyncio
async def test_an_unknown_address_is_not_found(
    test_client: Any, test_db: Any, test_settings: Any
) -> None:
    keep = await _org(test_db, "Reno Tenants Union")
    headers = enable_staff_auth(test_settings)

    missing_keep = await test_client.get(
        "/api/merges/preview",
        params={"keep": "nobody", "duplicate": keep.slug},
        headers=headers.staff,
    )
    missing_duplicate = await test_client.post(
        "/api/merges",
        json={"keep": keep.slug, "duplicate": "nobody", "reason": REASON},
        headers=headers.staff,
    )

    assert missing_keep.status_code == HTTPStatus.NOT_FOUND
    assert missing_keep.json()["detail"] == "No profile has the address nobody."
    assert missing_duplicate.status_code == HTTPStatus.NOT_FOUND
