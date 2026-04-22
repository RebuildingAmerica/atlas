"""Tests for connection computation and endpoint."""

import pytest

from atlas.domains.catalog.models.connections import compute_connections
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.models.database import db as database

STATUS_OK = 200


class TestConnectionComputation:
    """Verify that connection groups are correctly computed from entry data."""

    @pytest.mark.asyncio
    async def test_same_organization_connection(self, test_db: object) -> None:
        conn = test_db
        org_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Prairie Workers Cooperative",
            description="Worker cooperative",
            city=None,
            state=None,
            geo_specificity="regional",
        )
        person_a_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Founder",
            city=None,
            state=None,
            geo_specificity="local",
            affiliated_org_id=org_id,
        )
        person_b_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="John Smith",
            description="Member",
            city=None,
            state=None,
            geo_specificity="local",
            affiliated_org_id=org_id,
        )

        connections = await compute_connections(conn, person_a_id)
        same_org = next((g for g in connections if g["type"] == "same_organization"), None)
        assert same_org is not None
        actor_ids = [a["id"] for a in same_org["actors"]]
        assert person_b_id in actor_ids
        assert org_id in actor_ids

    @pytest.mark.asyncio
    async def test_co_mentioned_connection(self, test_db: object) -> None:
        conn = test_db
        person_a_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Person A",
            city=None,
            state=None,
            geo_specificity="local",
        )
        person_b_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="John Smith",
            description="Person B",
            city=None,
            state=None,
            geo_specificity="local",
        )

        source_id = database.generate_uuid()
        await conn.execute(
            "INSERT INTO sources (id, url, title, publication, type, extraction_method, ingested_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
            (
                source_id,
                "https://example.com/article",
                "Shared Article",
                "KC Star",
                "news_article",
                "manual",
            ),
        )
        await conn.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) VALUES (?, ?, datetime('now'))",
            (person_a_id, source_id),
        )
        await conn.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) VALUES (?, ?, datetime('now'))",
            (person_b_id, source_id),
        )
        await conn.commit()

        connections = await compute_connections(conn, person_a_id)
        co_mentioned = next((g for g in connections if g["type"] == "co_mentioned"), None)
        assert co_mentioned is not None
        actor_ids = [a["id"] for a in co_mentioned["actors"]]
        assert person_b_id in actor_ids
        evidence = co_mentioned["actors"][0]["evidence"]
        assert "KC Star" in evidence

    @pytest.mark.asyncio
    async def test_same_geography_connection(self, test_db: object) -> None:
        conn = test_db
        person_a_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Person in KC",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        await EntryCRUD.create(
            conn,
            entry_type="person",
            name="John Smith",
            description="Also in KC",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )

        connections = await compute_connections(conn, person_a_id)
        same_geo = next((g for g in connections if g["type"] == "same_geography"), None)
        assert same_geo is not None
        assert any("Kansas City" in a["evidence"] for a in same_geo["actors"])

    @pytest.mark.asyncio
    async def test_same_issue_area_connection(self, test_db: object) -> None:
        conn = test_db
        person_a_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Housing advocate",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        person_b_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="John Smith",
            description="Also housing",
            city="Topeka",
            state="MO",
            geo_specificity="local",
        )
        # Link both to the same issue area
        await conn.execute(
            "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
            (person_a_id, "housing_affordability"),
        )
        await conn.execute(
            "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
            (person_b_id, "housing_affordability"),
        )
        await conn.commit()

        connections = await compute_connections(conn, person_a_id)
        same_issue = next((g for g in connections if g["type"] == "same_issue_area"), None)
        assert same_issue is not None
        actor_ids = [a["id"] for a in same_issue["actors"]]
        assert person_b_id in actor_ids

    @pytest.mark.asyncio
    async def test_returns_empty_for_isolated_entry(self, test_db: object) -> None:
        conn = test_db
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Isolated Person",
            description="No connections",
            city=None,
            state=None,
            geo_specificity="local",
        )
        connections = await compute_connections(conn, entry_id)
        total_actors = sum(len(g["actors"]) for g in connections)
        assert total_actors == 0


class TestConnectionsEndpoint:
    """Verify the HTTP endpoint returns connection data."""

    @pytest.mark.asyncio
    async def test_returns_connections(self, test_client: object, test_db: object) -> None:
        conn = test_db
        org_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Test Org",
            description="Org",
            city=None,
            state=None,
            geo_specificity="regional",
        )
        await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Person A",
            description="Affiliated",
            city=None,
            state=None,
            geo_specificity="local",
            affiliated_org_id=org_id,
        )
        person_b_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Person B",
            description="Also affiliated",
            city=None,
            state=None,
            geo_specificity="local",
            affiliated_org_id=org_id,
        )

        response = await test_client.get(f"/api/entities/{person_b_id}/connections")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert "connections" in data
        assert len(data["connections"]) > 0
