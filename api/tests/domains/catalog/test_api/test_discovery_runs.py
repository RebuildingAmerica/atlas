"""Discovery run endpoint tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest


class TestDiscoveryRunEndpoints:
    @pytest.mark.asyncio
    async def test_start_discovery_run(self, test_client: object) -> None:
        response = await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["housing_affordability", "worker_cooperatives"],
            },
        )
        assert response.status_code == HTTPStatus.ACCEPTED
        data = response.json()
        assert data["state"] == "MO"
        assert data["status"] == "completed"

    @pytest.mark.asyncio
    async def test_start_discovery_run_invalid_issue_area(self, test_client: object) -> None:
        response = await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Test City, TS",
                "state": "TS",
                "issue_areas": ["invalid_issue"],
            },
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST

    @pytest.mark.asyncio
    async def test_list_discovery_runs(self, test_client: object) -> None:
        await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["housing_affordability"],
            },
        )

        response = await test_client.get("/api/discovery-runs")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert len(data["items"]) >= 1
        assert "total" in data
        assert "next_cursor" in data

    @pytest.mark.asyncio
    async def test_get_discovery_run(self, test_client: object) -> None:
        create_response = await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Test City, TS",
                "state": "TS",
                "issue_areas": ["housing_affordability"],
            },
        )
        run_id = create_response.json()["id"]

        response = await test_client.get(f"/api/discovery-runs/{run_id}")
        assert response.status_code == HTTPStatus.OK
        assert response.json()["id"] == run_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_discovery_run(self, test_client: object) -> None:
        response = await test_client.get("/api/discovery-runs/nonexistent")
        assert response.status_code == HTTPStatus.NOT_FOUND
