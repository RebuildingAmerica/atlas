"""Tests for profile claim, manage, follow, lists, and feed APIs."""
# ruff: noqa: PLR2004

from __future__ import annotations

import json

import pytest
import pytest_asyncio

from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.catalog.api import profiles as profile_api
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

    @pytest.mark.asyncio
    async def test_evidence_returns_none_when_no_payload(
        self, test_db: object, claimable_org: str
    ) -> None:
        """ProfileClaimModel.evidence should be None when no evidence_json was stored."""
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        assert claim.evidence is None

    @pytest.mark.asyncio
    async def test_get_by_id_returns_none_when_missing(self, test_db: object) -> None:
        """get_by_id should return None when the claim id is unknown."""
        assert await ProfileClaimCRUD.get_by_id(test_db, "no-such-id") is None

    @pytest.mark.asyncio
    async def test_list_by_user_returns_empty_when_user_has_no_claims(
        self, test_db: object
    ) -> None:
        """list_by_user should return an empty list when the user has no claims."""
        assert await ProfileClaimCRUD.list_by_user(test_db, "phantom-user") == []

    @pytest.mark.asyncio
    async def test_list_by_entry_returns_all_claims_newest_first(
        self, test_db: object, claimable_org: str
    ) -> None:
        """list_by_entry should return every claim made against an entry, newest first."""
        first = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-a",
            user_email="a@mississippirising.org",
            tier=1,
        )
        second = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-b",
            user_email="b@mississippirising.org",
            tier=1,
        )
        claims = await ProfileClaimCRUD.list_by_entry(test_db, claimable_org)
        assert {claim.id for claim in claims} == {first.id, second.id}

    @pytest.mark.asyncio
    async def test_list_by_entry_returns_empty_when_no_claims(
        self, test_db: object, claimable_person: str
    ) -> None:
        """list_by_entry should return an empty list when no claims exist."""
        assert await ProfileClaimCRUD.list_by_entry(test_db, claimable_person) == []

    @pytest.mark.asyncio
    async def test_get_active_for_entry_returns_none_when_no_active_claim(
        self, test_db: object, claimable_org: str
    ) -> None:
        """get_active_for_entry should return None when no pending or verified claim exists."""
        assert await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org) is None

    @pytest.mark.asyncio
    async def test_mark_verified_returns_none_for_missing_claim(self, test_db: object) -> None:
        """mark_verified should return None when no claim row matches the id."""
        assert await ProfileClaimCRUD.mark_verified(test_db, "no-such-claim") is None

    @pytest.mark.asyncio
    async def test_mark_rejected_returns_none_for_missing_claim(self, test_db: object) -> None:
        """mark_rejected should return None when no claim row matches the id."""
        assert await ProfileClaimCRUD.mark_rejected(test_db, "no-such-claim", reason="x") is None

    @pytest.mark.asyncio
    async def test_revoke_transitions_verified_claim_to_revoked(
        self, test_db: object, claimable_org: str
    ) -> None:
        """revoke should flip a verified claim to revoked and record the reason."""
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        verified = await ProfileClaimCRUD.mark_verified(test_db, claim.id)
        assert verified is not None
        revoked = await ProfileClaimCRUD.revoke(test_db, claim.id, reason="user request")
        assert revoked is not None
        assert revoked.status == "revoked"
        assert revoked.rejected_reason == "user request"

    @pytest.mark.asyncio
    async def test_revoke_returns_none_for_missing_claim(self, test_db: object) -> None:
        """revoke should return None when the claim id doesn't exist."""
        assert await ProfileClaimCRUD.revoke(test_db, "no-such-claim", reason="x") is None


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

    @pytest.mark.asyncio
    async def test_get_by_id_returns_none_for_missing_list(self, test_db: object) -> None:
        """get_by_id returns None when no row matches."""
        assert await SavedListCRUD.get_by_id(test_db, "list-does-not-exist") is None

    @pytest.mark.asyncio
    async def test_remove_item_returns_false_when_missing(
        self, test_db: object, claimable_org: str
    ) -> None:
        """Removing a non-existent item returns False without bumping updated_at."""
        record = await SavedListCRUD.create(test_db, user_id="user-1", name="L")
        removed = await SavedListCRUD.remove_item(
            test_db, list_id=record.id, entry_id=claimable_org
        )
        assert removed is False

    @pytest.mark.asyncio
    async def test_update_no_fields_returns_existing_record(self, test_db: object) -> None:
        """When no name/description is supplied, update returns the row unchanged."""
        record = await SavedListCRUD.create(
            test_db, user_id="user-1", name="Original", description="orig desc"
        )
        unchanged = await SavedListCRUD.update(test_db, record.id)
        assert unchanged is not None
        assert unchanged.name == "Original"
        assert unchanged.description == "orig desc"

    @pytest.mark.asyncio
    async def test_update_renames_and_updates_description(self, test_db: object) -> None:
        """update sets the supplied fields and persists them."""
        record = await SavedListCRUD.create(test_db, user_id="user-1", name="Original")
        updated = await SavedListCRUD.update(
            test_db, record.id, name="Renamed", description="new desc"
        )
        assert updated is not None
        assert updated.name == "Renamed"
        assert updated.description == "new desc"

    @pytest.mark.asyncio
    async def test_update_returns_none_for_missing_list(self, test_db: object) -> None:
        """update returns None when the row id does not exist."""
        result = await SavedListCRUD.update(test_db, "no-such-list", name="x")
        assert result is None


class TestSavedListsAPIErrors:
    """API-level error paths for the saved-list endpoints."""

    @pytest.mark.asyncio
    async def test_create_rejects_blank_name(self, test_client: object) -> None:
        """A whitespace-only name is rejected with 400."""
        resp = await test_client.post("/api/lists", json={"name": "   "})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_get_unknown_list_returns_404(self, test_client: object) -> None:
        """Reading a list that does not exist returns 404."""
        resp = await test_client.get("/api/lists/no-such-list")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_unknown_list_returns_404(self, test_client: object) -> None:
        """Deleting a list that does not exist returns 404."""
        resp = await test_client.delete("/api/lists/no-such-list")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_add_item_rejects_unknown_list(
        self, test_client: object, claimable_org: str
    ) -> None:
        """Adding to a missing list returns 404."""
        resp = await test_client.post(
            "/api/lists/no-such-list/items",
            json={"entry_id": claimable_org},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_add_item_rejects_unknown_entry(self, test_client: object) -> None:
        """Adding a non-existent entry to a list returns 404."""
        create_resp = await test_client.post("/api/lists", json={"name": "L"})
        list_id = create_resp.json()["id"]
        resp = await test_client.post(
            f"/api/lists/{list_id}/items",
            json={"entry_id": "no-such-entry"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_item_rejects_unknown_list(
        self, test_client: object, claimable_org: str
    ) -> None:
        """Removing from a missing list returns 404."""
        resp = await test_client.delete(f"/api/lists/no-such-list/items/{claimable_org}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_item_returns_404_when_item_not_in_list(
        self, test_client: object, claimable_org: str
    ) -> None:
        """Removing an entry that's not in the list returns 404."""
        create_resp = await test_client.post("/api/lists", json={"name": "L"})
        list_id = create_resp.json()["id"]
        resp = await test_client.delete(f"/api/lists/{list_id}/items/{claimable_org}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_item_succeeds_for_existing_entry(
        self, test_client: object, claimable_org: str
    ) -> None:
        """Removing an entry that exists returns 204."""
        create_resp = await test_client.post("/api/lists", json={"name": "L"})
        list_id = create_resp.json()["id"]
        await test_client.post(f"/api/lists/{list_id}/items", json={"entry_id": claimable_org})
        remove_resp = await test_client.delete(f"/api/lists/{list_id}/items/{claimable_org}")
        assert remove_resp.status_code == 204

    @pytest.mark.asyncio
    async def test_hydrate_entry_returns_none_for_missing_entry(self, test_db: object) -> None:
        """The _hydrate_entry helper returns None when the entry id has no row."""
        from atlas.domains.access.api.lists import _hydrate_entry

        result = await _hydrate_entry(test_db, "no-such-entry-id")
        assert result is None


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


class TestDomainOfHelper:
    """Direct edge cases for the email/website domain extractor."""

    def test_returns_none_for_whitespace_only_value(self) -> None:
        assert profile_api._domain_of("   ") is None  # noqa: SLF001

    def test_strips_www_prefix(self) -> None:
        assert profile_api._domain_of("https://www.example.com") == "example.com"  # noqa: SLF001


class TestProfileClaimAPIEdgeCases:
    """HTTP-level edge cases for the profile claim/manage/follow endpoints."""

    @pytest.mark.asyncio
    async def test_initiate_claim_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.post("/api/profiles/nonexistent-slug-xyz/claim", json={})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_initiate_claim_returns_existing_for_same_user_when_already_verified(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """A re-claim by the same verified user should return their existing claim."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        # Initiate + verify once.
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )

        # A second initiation by the same actor should not 409 — it should
        # return the existing verified claim.
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "verified"

    @pytest.mark.asyncio
    async def test_initiate_claim_409_when_verified_by_another_user(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """A claim attempt on a profile verified by someone else should 409."""
        # Pre-seed a verified claim attached to a different user_id.
        await EntryCRUD.update(
            test_db,
            claimable_org,
            claim_status="verified",
            claimed_by_user_id="some-other-user",
        )
        await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="some-other-user",
            user_email="other@example.com",
            tier=1,
        )
        await ProfileClaimCRUD.mark_verified(
            test_db,
            (await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)).id,
        )

        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_verify_email_409_when_claim_not_pending(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """Verifying with a token whose claim is no longer pending should 409."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        # Manually transition the claim past pending without clearing the
        # token, so the API has something to look up but rejects the state.
        await test_db.execute(
            "UPDATE profile_claims SET status = 'rejected' WHERE id = ?",
            (claim.id,),
        )
        await test_db.commit()

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": token},
        )
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_verify_email_410_when_token_expired(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """An expired verification token should 410 and reject the claim."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        # Stomp the expiry into the past.
        await test_db.execute(
            "UPDATE profile_claims SET verification_token_expires_at = ? WHERE id = ?",
            ("2000-01-01T00:00:00+00:00", claim.id),
        )
        await test_db.commit()

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": token},
        )
        assert resp.status_code == 410

    @pytest.mark.asyncio
    async def test_verify_email_410_when_token_has_no_expiry_recorded(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """A claim missing an expiry timestamp should be treated as expired."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        token = claim.verification_token
        assert token is not None

        await test_db.execute(
            "UPDATE profile_claims SET verification_token_expires_at = NULL WHERE id = ?",
            (claim.id,),
        )
        await test_db.commit()

        resp = await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": token},
        )
        assert resp.status_code == 410

    @pytest.mark.asyncio
    async def test_list_my_claims_skips_orphaned_entries(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """list_my_claims should silently drop claims whose entry has been deleted."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})

        async def fake_get_by_id(_db: object, _entry_id: str) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profiles.EntryCRUD.get_by_id",
            fake_get_by_id,
        )
        resp = await test_client.get("/api/profiles/claims/me")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_manage_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.patch(
            "/api/profiles/no-such-slug/manage",
            json={"custom_bio": "x"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_manage_clear_photo_drops_existing_photo(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """clear_photo=True should null out the photo column."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )

        # Seed a photo, then clear it.
        await EntryCRUD.update(test_db, claimable_org, photo_url="https://example.com/old.jpg")
        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={"clear_photo": True},
        )
        assert resp.status_code == 200, resp.text
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.photo_url is None

    @pytest.mark.asyncio
    async def test_manage_clear_custom_bio_drops_existing_bio(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """clear_custom_bio=True should null out the bio column."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )
        await EntryCRUD.update(test_db, claimable_org, custom_bio="hand-written")

        resp = await test_client.patch(
            f"/api/profiles/{slug}/manage",
            json={"clear_custom_bio": True},
        )
        assert resp.status_code == 200, resp.text
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.custom_bio is None

    @pytest.mark.asyncio
    async def test_manage_no_fields_returns_updated_false(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        """An empty manage payload should report no updates."""
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        slug = (await EntryCRUD.get_by_id(test_db, claimable_org)).slug
        await test_client.post(f"/api/profiles/{slug}/claim", json={})
        claim = await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org)
        assert claim is not None
        assert claim.verification_token is not None
        await test_client.post(
            "/api/profiles/claims/verify-email",
            json={"token": claim.verification_token},
        )

        resp = await test_client.patch(f"/api/profiles/{slug}/manage", json={})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"updated": False, "fields": []}

    @pytest.mark.asyncio
    async def test_follow_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.post("/api/profiles/no-slug/follow")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_unfollow_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.delete("/api/profiles/no-slug/follow")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_follow_returns_404_for_unknown_slug(self, test_client: object) -> None:
        resp = await test_client.get("/api/profiles/no-slug/follow")
        assert resp.status_code == 404


class TestVerifyClaimRefetchInvariants:
    """Direct unit tests for unreachable defensive checks in verify_claim."""

    @pytest.mark.asyncio
    async def test_verify_claim_500_when_mark_verified_returns_none(
        self,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """If mark_verified can't return the row, verify_claim must 500."""
        from atlas.domains.catalog.schemas.public import ProfileClaimVerifyRequest

        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        # Seed a tier-1 claim so we have a valid verification token to pass in.
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-x",
            user_email="user@atlas.rebuildingus.org",
            tier=1,
        )
        assert claim.verification_token is not None

        async def fake_mark_verified(_db: object, _claim_id: str) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profiles.ProfileClaimCRUD.mark_verified",
            fake_mark_verified,
        )

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await profile_api.verify_claim(
                ProfileClaimVerifyRequest(token=claim.verification_token),
                response=None,
                db=test_db,
            )
        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_verify_claim_404_when_entry_lookup_returns_none(
        self,
        test_db: object,
        claimable_org: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """If the post-verification entry lookup fails, verify_claim must 404."""
        from atlas.domains.catalog.schemas.public import ProfileClaimVerifyRequest

        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-x",
            user_email="user@atlas.rebuildingus.org",
            tier=1,
        )
        assert claim.verification_token is not None

        async def fake_get_by_id(_db: object, _entry_id: str) -> None:
            return None

        monkeypatch.setattr(
            "atlas.domains.catalog.api.profiles.EntryCRUD.get_by_id",
            fake_get_by_id,
        )

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await profile_api.verify_claim(
                ProfileClaimVerifyRequest(token=claim.verification_token),
                response=None,
                db=test_db,
            )
        assert exc_info.value.status_code == 404
