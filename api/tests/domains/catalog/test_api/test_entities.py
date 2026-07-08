"""Entity endpoint tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.models import EntryCRUD


class TestEntityEndpoints:
    @pytest.mark.asyncio
    async def test_create_entity(self, test_client: object) -> None:
        response = await test_client.post(
            "/api/entities",
            json={
                "type": "organization",
                "name": "Test Org",
                "description": "A test organization.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "full_address": "123 Main St, Kansas City, MO 64106",
                "issue_areas": ["housing_affordability"],
            },
        )
        assert response.status_code == HTTPStatus.CREATED
        data = response.json()
        assert data["name"] == "Test Org"
        assert data["address"]["state"] == "MO"
        assert data["address"]["full_address"] == "123 Main St, Kansas City, MO 64106"
        assert data["issue_area_ids"] == ["housing_affordability"]

    @pytest.mark.asyncio
    async def test_create_entity_invalid_issue_area(self, test_client: object) -> None:
        response = await test_client.post(
            "/api/entities",
            json={
                "type": "organization",
                "name": "Test",
                "description": "Test organization with invalid issue area.",
                "city": "Test",
                "state": "TS",
                "geo_specificity": "local",
                "issue_areas": ["invalid_issue_area"],
            },
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST

    @pytest.mark.asyncio
    async def test_list_entities(self, test_client: object, test_db: object) -> None:
        await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Test Org",
            description="Test.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )

        response = await test_client.get("/api/entities")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert len(data["items"]) >= 1
        assert "facets" in data
        assert "total" in data
        assert "next_cursor" in data
        assert "pagination" not in data

    @pytest.mark.asyncio
    async def test_private_org_entries_do_not_leak_through_public_entity_reads(
        self, test_client: object, test_db: object
    ) -> None:
        private_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Private Tenant Lead",
            description="Private partner prospect.",
            city="Detroit",
            state="MI",
            geo_specificity="local",
        )
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id=private_id,
            resource_type="entry",
            org_id="local",
            visibility="private",
            created_by="local-user",
        )
        public_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Shared Commons Org",
            description="Public source-linked organization.",
            city="Detroit",
            state="MI",
            geo_specificity="local",
        )

        list_response = await test_client.get("/api/entities?state=MI")
        assert list_response.status_code == HTTPStatus.OK
        names = {item["name"] for item in list_response.json()["items"]}
        assert "Shared Commons Org" in names
        assert "Private Tenant Lead" not in names

        detail_response = await test_client.get(f"/api/entities/{private_id}")
        assert detail_response.status_code == HTTPStatus.NOT_FOUND

        private_entry = await EntryCRUD.get_by_id(test_db, private_id)
        assert private_entry is not None
        slug_response = await test_client.get(
            f"/api/entities/by-slug/organizations/{private_entry.slug}"
        )
        assert slug_response.status_code == HTTPStatus.NOT_FOUND

        sources_response = await test_client.get(f"/api/entities/{private_id}/sources")
        connections_response = await test_client.get(f"/api/entities/{private_id}/connections")
        assert sources_response.status_code == HTTPStatus.NOT_FOUND
        assert connections_response.status_code == HTTPStatus.NOT_FOUND

        public_response = await test_client.get(f"/api/entities/{public_id}")
        assert public_response.status_code == HTTPStatus.OK

    @pytest.mark.asyncio
    async def test_list_entities_by_state(self, test_client: object, test_db: object) -> None:
        await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="MO Person",
            description="Test.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="KS Person",
            description="Test.",
            city="Topeka",
            state="KS",
            geo_specificity="local",
        )

        response = await test_client.get("/api/entities?state=MO")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert all(entity["address"]["state"] == "MO" for entity in data["items"])

    @pytest.mark.asyncio
    async def test_get_entity(self, test_client: object, test_db: object) -> None:
        entity_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Test Org",
            description="Test.",
            city="Test City",
            state="TS",
            geo_specificity="local",
        )

        response = await test_client.get(f"/api/entities/{entity_id}")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert data["id"] == entity_id
        assert data["name"] == "Test Org"
        assert "sources" in data

    @pytest.mark.asyncio
    async def test_get_nonexistent_entity(self, test_client: object) -> None:
        response = await test_client.get("/api/entities/nonexistent-id")
        assert response.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_entity(self, test_client: object, test_db: object) -> None:
        entity_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Original Name",
            description="Test.",
            city="Test",
            state="TS",
            geo_specificity="local",
        )

        response = await test_client.patch(
            f"/api/entities/{entity_id}",
            json={"name": "Updated Name"},
        )
        assert response.status_code == HTTPStatus.OK
        assert response.json()["name"] == "Updated Name"

    @pytest.mark.asyncio
    async def test_delete_entity(self, test_client: object, test_db: object) -> None:
        entity_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="To Delete",
            description="Test.",
            city="Test",
            state="TS",
            geo_specificity="local",
        )

        response = await test_client.delete(f"/api/entities/{entity_id}")
        assert response.status_code == HTTPStatus.NO_CONTENT

    @pytest.mark.asyncio
    async def test_update_entity_rejects_non_owner_org(
        self, test_client: object, test_db: object
    ) -> None:
        entity_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Owned Elsewhere",
            description="Test.",
            city="Test",
            state="TS",
            geo_specificity="local",
        )
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id=entity_id,
            resource_type="entry",
            org_id="some-other-org",
            visibility="private",
            created_by="someone-else",
        )

        response = await test_client.patch(f"/api/entities/{entity_id}", json={"name": "Hijack"})
        assert response.status_code == HTTPStatus.FORBIDDEN

    @pytest.mark.asyncio
    async def test_delete_entity_rejects_non_owner_org(
        self, test_client: object, test_db: object
    ) -> None:
        entity_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Owned Elsewhere",
            description="Test.",
            city="Test",
            state="TS",
            geo_specificity="local",
        )
        await OwnershipCRUD.create_ownership(
            test_db,
            resource_id=entity_id,
            resource_type="entry",
            org_id="some-other-org",
            visibility="private",
            created_by="someone-else",
        )

        response = await test_client.delete(f"/api/entities/{entity_id}")
        assert response.status_code == HTTPStatus.FORBIDDEN
