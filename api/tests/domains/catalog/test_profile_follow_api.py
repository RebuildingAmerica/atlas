"""Tests for profile follow APIs and persistence."""
# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.domains.access.models.follows import FollowCRUD
from atlas.models import EntryCRUD, SourceCRUD


class TestFollowAPI:
    """Follow / unfollow endpoints."""

    @pytest.mark.asyncio
    async def test_follow_creates_record(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/follow")
        assert resp.status_code == 201
        body = resp.json()
        assert body["entry_id"] == claimable_org

        get_resp = await test_client.get(f"/api/profiles/{slug}/follow")
        assert get_resp.status_code == 200
        assert get_resp.json() is not None

    @pytest.mark.asyncio
    async def test_unfollow_removes_record(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/follow")
        delete_resp = await test_client.delete(f"/api/profiles/{slug}/follow")
        assert delete_resp.status_code == 204
        get_resp = await test_client.get(f"/api/profiles/{slug}/follow")
        assert get_resp.json() is None

    @pytest.mark.asyncio
    async def test_feed_following_returns_recent_sources(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
    ) -> None:
        # Create a source linked to the entry.
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/article-1",
            source_type="news_article",
            extraction_method="manual",
            title="Recent coverage",
            publication="MS Today",
        )
        await test_db.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) "
            "VALUES (?, ?, CURRENT_TIMESTAMP)",
            (claimable_org, source_id),
        )
        await test_db.commit()

        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/follow")
        feed = await test_client.get("/api/feed/following")
        assert feed.status_code == 200
        items = feed.json()["items"]
        assert any(item["source_id"] == source_id for item in items)


class TestFollowCRUDDirect:
    """Direct model-level coverage for FollowCRUD."""

    @pytest.mark.asyncio
    async def test_follow_idempotent(self, test_db: object, claimable_org: str) -> None:
        first = await FollowCRUD.follow(test_db, user_id="u", entry_id=claimable_org)
        again = await FollowCRUD.follow(test_db, user_id="u", entry_id=claimable_org)
        assert first.entry_id == again.entry_id
        # Still only one row in DB.
        cursor = await test_db.execute(
            "SELECT COUNT(*) FROM profile_follows WHERE user_id = ? AND entry_id = ?",
            ("u", claimable_org),
        )
        row = await cursor.fetchone()
        assert row[0] == 1

    @pytest.mark.asyncio
    async def test_unfollow_removes_subscription(self, test_db: object, claimable_org: str) -> None:
        await FollowCRUD.follow(test_db, user_id="u", entry_id=claimable_org)
        deleted = await FollowCRUD.unfollow(test_db, user_id="u", entry_id=claimable_org)
        assert deleted is True
        # Second unfollow returns False — already gone.
        deleted_again = await FollowCRUD.unfollow(test_db, user_id="u", entry_id=claimable_org)
        assert deleted_again is False

    @pytest.mark.asyncio
    async def test_is_following_reflects_state(self, test_db: object, claimable_org: str) -> None:
        assert await FollowCRUD.is_following(test_db, user_id="u", entry_id=claimable_org) is None
        await FollowCRUD.follow(test_db, user_id="u", entry_id=claimable_org)
        record = await FollowCRUD.is_following(test_db, user_id="u", entry_id=claimable_org)
        assert record is not None
        assert record.entry_id == claimable_org

    @pytest.mark.asyncio
    async def test_list_for_user_returns_all_follows(
        self, test_db: object, claimable_org: str
    ) -> None:
        await FollowCRUD.follow(test_db, user_id="u", entry_id=claimable_org)
        rows = await FollowCRUD.list_for_user(test_db, "u")
        assert len(rows) == 1
        assert rows[0].entry_id == claimable_org

    @pytest.mark.asyncio
    async def test_feed_updates_empty_for_user_without_follows(self, test_db: object) -> None:
        events = await FollowCRUD.feed_updates(test_db, "no-follows-user")
        assert events == []

    @pytest.mark.asyncio
    async def test_feed_updates_returns_source_events_for_followed_entry(
        self,
        test_db: object,
        claimable_org: str,
        sample_source: str,
    ) -> None:
        from atlas.platform.database import db as _db

        await FollowCRUD.follow(test_db, user_id="u", entry_id=claimable_org)
        await test_db.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) VALUES (?, ?, ?)",
            (claimable_org, sample_source, _db.now_iso()),
        )
        await test_db.commit()
        events = await FollowCRUD.feed_updates(test_db, "u")
        assert events
        assert events[0]["entry_id"] == claimable_org
        assert events[0]["source_id"] == sample_source
