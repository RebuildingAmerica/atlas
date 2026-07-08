"""Tests for empty results and the API endpoint."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections

from .helpers import _make_org, _make_person


class TestEmptyCases:
    @pytest.mark.asyncio
    async def test_isolated_entry(self, test_db: object) -> None:
        entry_id = await _make_person(test_db, "Isolated Person")
        result = await compute_connections(test_db, entry_id)
        assert result.actors == []
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_unknown_entry(self, test_db: object) -> None:
        result = await compute_connections(test_db, "no-such-entry-id")
        assert result.actors == []
        assert result.total == 0


class TestConnectionsEndpoint:
    @pytest.mark.asyncio
    async def test_returns_ranked_actors_and_total(
        self, test_client: object, test_db: object
    ) -> None:
        org_id = await _make_org(test_db, "Test Org")
        await _make_person(test_db, "Person A", org_id=org_id)
        person_b = await _make_person(test_db, "Person B", org_id=org_id)

        response = await test_client.get(f"/api/entities/{person_b}/connections")

        assert response.status_code == 200
        data = response.json()
        assert "actors" in data
        assert "total" in data
        assert len(data["actors"]) > 0
        assert "strength" in data["actors"][0]
        assert "reasons" in data["actors"][0]

    @pytest.mark.asyncio
    async def test_pagination_query_param(self, test_client: object, test_db: object) -> None:
        org_id = await _make_org(test_db, "Paged Org")
        person_a = await _make_person(test_db, "Anchor", org_id=org_id)
        await _make_person(test_db, "Teammate", org_id=org_id)

        response = await test_client.get(f"/api/entities/{person_a}/connections?limit=1")

        assert response.status_code == 200
        data = response.json()
        assert len(data["actors"]) == 1
        assert data["total"] >= 2
