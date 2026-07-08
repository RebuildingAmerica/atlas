"""Health and taxonomy endpoint tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest

FULL_TAXONOMY_ITEM_COUNT = 11
ECONOMIC_SECURITY_ISSUE_AREA_COUNT = 5


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_check(self, test_client: object) -> None:
        response = await test_client.get("/health")
        assert response.status_code == HTTPStatus.OK
        assert response.json()["status"] == "ok"


class TestTaxonomyEndpoints:
    @pytest.mark.asyncio
    async def test_get_full_taxonomy(self, test_client: object) -> None:
        response = await test_client.get("/api/domains")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert len(data["items"]) == FULL_TAXONOMY_ITEM_COUNT
        slugs = {item["slug"] for item in data["items"]}
        assert "economic-security" in slugs
        assert "labor-and-worker-power" in slugs

    @pytest.mark.asyncio
    async def test_get_domain_issues(self, test_client: object) -> None:
        response = await test_client.get("/api/domains/economic-security")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert data["slug"] == "economic-security"
        assert len(data["issue_areas"]) == ECONOMIC_SECURITY_ISSUE_AREA_COUNT
        slugs = {item["slug"] for item in data["issue_areas"]}
        assert "worker_cooperatives" not in slugs

    @pytest.mark.asyncio
    async def test_get_invalid_domain(self, test_client: object) -> None:
        response = await test_client.get("/api/domains/invalid-domain")
        assert response.status_code == HTTPStatus.NOT_FOUND

    @pytest.mark.asyncio
    async def test_query_issue_areas(self, test_client: object) -> None:
        response = await test_client.get("/api/issue-areas?query=housing")
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert data["items"]
        assert any(item["slug"] == "housing_affordability" for item in data["items"])
