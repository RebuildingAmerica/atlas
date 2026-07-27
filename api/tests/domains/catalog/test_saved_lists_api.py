"""Tests for saved-list API behavior."""
# ruff: noqa: PLR2004

from __future__ import annotations

from csv import DictReader
from io import StringIO

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.capabilities import resolve_capabilities
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.schemas.public import SavedListCreateRequest, SavedListItemRequest
from atlas.models import EntryCRUD, SourceCRUD


def _actor(*, products: list[str] | None = None) -> AuthenticatedActor:
    active_products = products or []
    actor = AuthenticatedActor(
        user_id="plan-test-user",
        email="plan-test@atlas.example",
        auth_type="oauth_jwt",
    )
    actor.active_products = active_products
    actor.resolved_capabilities = resolve_capabilities(active_products)
    return actor


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
        self, test_client: object, test_db: object, claimable_org: str
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
        assert await OrgUsageEventCRUD.count_by_type(test_db, org_id="local") == {
            "list_item_saved": 1
        }

    @pytest.mark.asyncio
    async def test_export_list_as_json_preserves_notes_and_provenance(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
    ) -> None:
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/mississippi-rising",
            source_type="news_article",
            extraction_method="manual",
            title="Mississippi Rising expands statewide organizing",
            publication="Delta Ledger",
        )
        await SourceCRUD.link_to_entry(test_db, claimable_org, source_id)

        create_resp = await test_client.post(
            "/api/lists",
            json={"name": "Mississippi power map", "description": "Follow-up leads"},
        )
        list_id = create_resp.json()["id"]
        await test_client.post(
            f"/api/lists/{list_id}/items",
            json={"entry_id": claimable_org, "note": "Ask about statewide partners."},
        )

        export_resp = await test_client.get(f"/api/lists/{list_id}/export")

        assert export_resp.status_code == 200
        body = export_resp.json()
        assert body["format"] == "json"
        assert body["list"]["id"] == list_id
        assert body["list"]["name"] == "Mississippi power map"
        assert body["provenance"] == {"item_count": 1, "source_count": 1}
        assert body["items"][0]["entry_id"] == claimable_org
        assert body["items"][0]["note"] == "Ask about statewide partners."
        assert body["items"][0]["entry"]["name"] == "Mississippi Rising"
        assert body["items"][0]["entry"]["source_count"] == 1
        assert body["items"][0]["trust_level"] == "unverified"
        assert body["items"][0]["sources"] == [
            {
                "id": source_id,
                "url": "https://example.com/mississippi-rising",
                "title": "Mississippi Rising expands statewide organizing",
                "publication": "Delta Ledger",
                "type": "news_article",
            }
        ]

    @pytest.mark.asyncio
    async def test_export_list_as_csv_preserves_research_rows(
        self,
        test_client: object,
        test_db: object,
        claimable_org: str,
    ) -> None:
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/mississippi-rising",
            source_type="news_article",
            extraction_method="manual",
        )
        await SourceCRUD.link_to_entry(test_db, claimable_org, source_id)
        create_resp = await test_client.post("/api/lists", json={"name": "MS / Delta Leads"})
        list_id = create_resp.json()["id"]
        await test_client.post(
            f"/api/lists/{list_id}/items",
            json={"entry_id": claimable_org, "note": "Invite to coalition call."},
        )

        export_resp = await test_client.get(f"/api/lists/{list_id}/export?format=csv")

        assert export_resp.status_code == 200
        assert export_resp.headers["content-type"].startswith("text/csv")
        assert export_resp.headers["content-disposition"] == (
            f'attachment; filename="ms-delta-leads-list-{list_id}.csv"'
        )
        rows = list(DictReader(StringIO(export_resp.text)))
        assert rows == [
            {
                "list_id": list_id,
                "list_name": "MS / Delta Leads",
                "entry_id": claimable_org,
                "name": "Mississippi Rising",
                "type": "organization",
                "location": "Jackson, MS",
                "source_count": "1",
                "trust_level": "unverified",
                "source_urls": "https://example.com/mississippi-rising",
                "note": "Invite to coalition call.",
                "added_at": rows[0]["added_at"],
                "profile_slug": rows[0]["profile_slug"],
            }
        ]

    @pytest.mark.asyncio
    async def test_membership_lookup(self, test_client: object, claimable_org: str) -> None:
        create_resp = await test_client.post("/api/lists", json={"name": "L"})
        list_id = create_resp.json()["id"]
        await test_client.post(f"/api/lists/{list_id}/items", json={"entry_id": claimable_org})

        membership = await test_client.get(f"/api/lists/membership/{claimable_org}")
        assert membership.status_code == 200
        assert list_id in membership.json()


class TestSavedListEntitlements:
    """Plan gates for saved-list features advertised on pricing."""

    @pytest.mark.asyncio
    async def test_free_actor_cannot_create_second_saved_list(self, test_db: object) -> None:
        from atlas.domains.access.api.lists import create_list

        actor = _actor()
        payload = SavedListCreateRequest(name="Free list", description=None)
        await create_list(payload, Response(), actor=actor, db=test_db)

        with pytest.raises(HTTPException) as excinfo:
            await create_list(
                SavedListCreateRequest(name="Second list", description=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["limit"] == "max_shortlists"

    @pytest.mark.asyncio
    async def test_free_actor_cannot_add_notes(self, test_db: object, claimable_org: str) -> None:
        from atlas.domains.access.api.lists import add_item, create_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        with pytest.raises(HTTPException) as excinfo:
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=claimable_org, note="follow up"),
                Response(),
                actor=actor,
                db=test_db,
            )

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["capability"] == "workspace.notes"

    @pytest.mark.asyncio
    async def test_free_actor_cannot_export_saved_lists(
        self, test_db: object, claimable_org: str
    ) -> None:
        from atlas.domains.access.api.lists import add_item, create_list, export_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        with pytest.raises(HTTPException) as excinfo:
            await export_list(created.id, Response(), actor=actor, db=test_db)

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["capability"] == "workspace.export"

    @pytest.mark.asyncio
    async def test_free_actor_cannot_exceed_entry_limit(
        self, test_db: object, claimable_org: str
    ) -> None:
        from atlas.domains.access.api.lists import add_item, create_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        for index in range(24):
            entry_id = await EntryCRUD.create(
                test_db,
                entry_type="organization",
                name=f"Limit Test Org {index}",
                description="Limit test organization.",
                city="Kansas City",
                state="MO",
                geo_specificity="local",
            )
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=entry_id, note=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        overflow_entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Limit Test Org Overflow",
            description="Overflow organization.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        with pytest.raises(HTTPException) as excinfo:
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=overflow_entry_id, note=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["limit"] == "max_shortlist_entries"

    @pytest.mark.asyncio
    async def test_free_actor_can_re_save_an_entry_already_at_the_limit(
        self, test_db: object, claimable_org: str
    ) -> None:
        """Re-adding an entry already in the list is not a new item, so it can't overflow."""
        from atlas.domains.access.api.lists import add_item, create_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        for index in range(24):
            entry_id = await EntryCRUD.create(
                test_db,
                entry_type="organization",
                name=f"Resave Limit Test Org {index}",
                description="Limit test organization.",
                city="Kansas City",
                state="MO",
                geo_specificity="local",
            )
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=entry_id, note=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        item = await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        assert item.entry_id == claimable_org

    @pytest.mark.asyncio
    async def test_research_pass_gets_team_level_list_access(
        self, test_db: object, claimable_org: str
    ) -> None:
        from atlas.domains.access.api.lists import add_item, create_list, export_list

        actor = _actor(products=["atlas_research_pass"])
        first = await create_list(
            SavedListCreateRequest(name="Pass list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        second = await create_list(
            SavedListCreateRequest(name="Second pass list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        item = await add_item(
            second.id,
            SavedListItemRequest(entry_id=claimable_org, note="follow up"),
            Response(),
            actor=actor,
            db=test_db,
        )
        exported = await export_list(first.id, Response(), actor=actor, db=test_db)

        assert item.note == "follow up"
        assert exported.list_.id == first.id


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
