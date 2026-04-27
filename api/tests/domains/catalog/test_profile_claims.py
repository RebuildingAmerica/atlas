"""Tests for profile claim, manage, follow, lists, and feed APIs."""
# ruff: noqa: PLR2004

from __future__ import annotations

import json

import pytest
import pytest_asyncio

from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.models import EntryCRUD, SourceCRUD


@pytest_asyncio.fixture
async def claimable_org(test_db: object) -> str:
    """Create an org with a clear email/website domain to support tier-1 claims."""
    return await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Mississippi Rising",
        description="Statewide organizing nonprofit.",
        city="Jackson",
        state="MS",
        geo_specificity="statewide",
        website="https://mississippirising.org",
        email="info@mississippirising.org",
    )


@pytest_asyncio.fixture
async def claimable_person(test_db: object) -> str:
    """Create a person without contact info — tier-2 claim path only."""
    return await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Marcus Lee",
        description="Tenant advocate in Tupelo.",
        city="Tupelo",
        state="MS",
        geo_specificity="local",
    )


class TestProfileClaimCRUD:
    """Direct model-level coverage for ProfileClaimCRUD."""

    @pytest.mark.asyncio
    async def test_create_tier_one_issues_token_and_expiry(
        self, test_db: object, claimable_org: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        assert claim.status == "pending"
        assert claim.tier == 1
        assert claim.verification_token is not None
        assert claim.verification_token_expires_at is not None

    @pytest.mark.asyncio
    async def test_create_tier_two_does_not_issue_token(
        self, test_db: object, claimable_person: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_person,
            user_id="user-1",
            user_email="marcus@example.org",
            tier=2,
            evidence={"linkedin": "https://linkedin.com/in/marcus"},
        )
        assert claim.tier == 2
        assert claim.verification_token is None
        assert claim.evidence == {"linkedin": "https://linkedin.com/in/marcus"}

    @pytest.mark.asyncio
    async def test_mark_verified_clears_token_and_sets_timestamp(
        self, test_db: object, claimable_org: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        verified = await ProfileClaimCRUD.mark_verified(test_db, claim.id)
        assert verified is not None
        assert verified.status == "verified"
        assert verified.verified_at is not None
        assert verified.verification_token is None

    @pytest.mark.asyncio
    async def test_mark_rejected_records_reason(
        self, test_db: object, claimable_person: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_person,
            user_id="user-1",
            user_email="marcus@example.org",
            tier=2,
            evidence={"note": "I am Marcus."},
        )
        rejected = await ProfileClaimCRUD.mark_rejected(test_db, claim.id, reason="cannot verify")
        assert rejected is not None
        assert rejected.status == "rejected"
        assert rejected.rejected_reason == "cannot verify"


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

    @pytest.mark.asyncio
    async def test_initiate_claim_tier_one_uses_email_domain_match(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        # In local deploy_mode the build_local_actor returns a fixed email; so we
        # construct a tier-1 entry whose email domain matches that local actor.
        # The default local actor email is "operator@atlas.test" — adjust the
        # entry to match for this test.
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        resp = await test_client.post(
            f"/api/profiles/{(await EntryCRUD.get_by_id(test_db, claimable_org)).slug}/claim",
            json={},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == 1
        assert body["status"] == "pending"

        # Entry's claim_status flips to pending and records claimed_by_user_id
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.claim_status == "pending"
        assert entry.claimed_by_user_id is not None

    @pytest.mark.asyncio
    async def test_initiate_claim_tier_two_requires_evidence(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 400

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim", json={"evidence": "I am Marcus, see linkedin."}
        )
        assert resp.status_code == 201
        assert resp.json()["tier"] == 2

    @pytest.mark.asyncio
    async def test_verify_email_marks_claim_and_entry_verified(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 201
        # Pull the token directly from the DB (the API doesn't return it).
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        verify = await test_client.post("/api/profiles/claims/verify-email", json={"token": token})
        assert verify.status_code == 200, verify.text
        body = verify.json()
        assert body["status"] == "verified"

        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.claim_status == "verified"
        assert entry.claim_verified_at is not None

    @pytest.mark.asyncio
    async def test_verify_email_rejects_unknown_token(self, test_client: object) -> None:
        resp = await test_client.post(
            "/api/profiles/claims/verify-email", json={"token": "no-such-token"}
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_list_my_claims_returns_user_records(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})

        resp = await test_client.get("/api/profiles/claims/me")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["entry_slug"] == slug


class TestProfileManageAPI:
    """Subject-management endpoint."""

    @pytest.mark.asyncio
    async def test_manage_requires_verified_claim(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={"custom_bio": "Updated bio"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_manage_persists_subject_fields(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        # Auto-verify by setting up a verified claim manually.
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email", json={"token": claim.verification_token}
        )

        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={
                "custom_bio": "I write my own story now.",
                "photo_url": "https://example.com/photo.jpg",
                "preferred_contact_channel": "email",
                "suppressed_source_ids": ["s1", "s2"],
            },
        )
        assert resp.status_code == 200, resp.text

        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.custom_bio == "I write my own story now."
        assert entry.photo_url == "https://example.com/photo.jpg"
        assert entry.preferred_contact_channel == "email"
        assert entry.suppressed_source_ids == ["s1", "s2"]


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
            "VALUES (?, ?, datetime('now'))",
            (claimable_org, source_id),
        )
        await test_db.commit()

        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/follow")
        feed = await test_client.get("/api/feed/following")
        assert feed.status_code == 200
        items = feed.json()["items"]
        assert any(item["source_id"] == source_id for item in items)


class TestSavedListsAPI:
    """Saved-list CRUD."""

    @pytest.mark.asyncio
    async def test_create_and_list_saved_lists(self, test_client: object) -> None:
        create_resp = await test_client.post(
            "/api/lists",
            json={"name": "Connecting America Tour", "description": "Mississippi housing"},
        )
        assert create_resp.status_code == 201
        list_id = create_resp.json()["id"]

        list_resp = await test_client.get("/api/lists")
        assert list_resp.status_code == 200
        names = [item["name"] for item in list_resp.json()]
        assert "Connecting America Tour" in names

        delete_resp = await test_client.delete(f"/api/lists/{list_id}")
        assert delete_resp.status_code == 204

    @pytest.mark.asyncio
    async def test_add_item_and_get_returns_hydrated_entry(
        self, test_client: object, claimable_org: str
    ) -> None:
        create_resp = await test_client.post("/api/lists", json={"name": "Test"})
        list_id = create_resp.json()["id"]
        add_resp = await test_client.post(
            f"/api/lists/{list_id}/items",
            json={"entry_id": claimable_org, "note": "follow up"},
        )
        assert add_resp.status_code == 201
        body = add_resp.json()
        assert body["entry_id"] == claimable_org
        assert body["entry"] is not None
        assert body["entry"]["id"] == claimable_org

        get_resp = await test_client.get(f"/api/lists/{list_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["item_count"] == 1

    @pytest.mark.asyncio
    async def test_membership_lookup(self, test_client: object, claimable_org: str) -> None:
        create_resp = await test_client.post("/api/lists", json={"name": "L"})
        list_id = create_resp.json()["id"]
        await test_client.post(f"/api/lists/{list_id}/items", json={"entry_id": claimable_org})

        membership = await test_client.get(f"/api/lists/membership/{claimable_org}")
        assert membership.status_code == 200
        assert list_id in membership.json()


class TestSuppressedSourcesFiltering:
    """Suppressed sources should not surface in the public detail response."""

    @pytest.mark.asyncio
    async def test_suppressed_source_excluded_from_detail(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/sup",
            source_type="news_article",
            extraction_method="manual",
            title="Suppressed",
        )
        await test_db.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) "
            "VALUES (?, ?, datetime('now'))",
            (claimable_org, source_id),
        )
        await test_db.commit()

        # Confirm the source appears in the public detail before suppression.
        detail = await test_client.get(f"/api/entities/{claimable_org}")
        assert detail.status_code == 200
        ids = {source["id"] for source in detail.json()["sources"]}
        assert source_id in ids

        # Suppress it directly via the model.
        await EntryCRUD.update(
            test_db,
            claimable_org,
            suppressed_source_ids=[source_id],
        )

        # Confirm the source is gone from the public detail.
        detail2 = await test_client.get(f"/api/entities/{claimable_org}")
        assert detail2.status_code == 200
        ids2 = {source["id"] for source in detail2.json()["sources"]}
        assert source_id not in ids2


class TestSavedListCRUDDirect:
    """Direct model-level coverage for SavedListCRUD."""

    @pytest.mark.asyncio
    async def test_add_and_remove_item(self, test_db: object, claimable_org: str) -> None:
        record = await SavedListCRUD.create(test_db, user_id="user-1", name="L")
        await SavedListCRUD.add_item(
            test_db, list_id=record.id, entry_id=claimable_org, note="check"
        )
        assert await SavedListCRUD.count_items(test_db, record.id) == 1
        removed = await SavedListCRUD.remove_item(
            test_db, list_id=record.id, entry_id=claimable_org
        )
        assert removed is True
        assert await SavedListCRUD.count_items(test_db, record.id) == 0


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


class TestEntityResponseFreshFields:
    """Verify the EntityResponse exposes the new fields."""

    @pytest.mark.asyncio
    async def test_response_includes_claim_block(
        self, test_client: object, claimable_org: str
    ) -> None:
        resp = await test_client.get(f"/api/entities/{claimable_org}")
        assert resp.status_code == 200
        body = resp.json()
        assert "claim" in body
        assert body["claim"]["status"] == "unclaimed"
        assert body["claim"]["verification_level"] == "source-derived"
        assert body["custom_bio"] is None
        assert body["photo_url"] is None
        # Ensure the JSON is well-formed by re-encoding.
        assert json.dumps(body)
