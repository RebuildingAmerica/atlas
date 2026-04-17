"""API endpoint tests."""

import pytest

from atlas.models import EntryCRUD

# HTTP status codes
STATUS_OK = 200
STATUS_CREATED = 201
STATUS_ACCEPTED = 202
STATUS_NO_CONTENT = 204
STATUS_BAD_REQUEST = 400
STATUS_NOT_FOUND = 404

# Domain and issue constants
EXPECTED_DOMAIN_COUNT = 11
EXPECTED_ECONOMIC_SECURITY_ISSUES = 5


class TestHealthEndpoint:
    """Tests for health check endpoint."""

    @pytest.mark.asyncio
    async def test_health_check(self, test_client: object) -> None:
        """Test health check endpoint."""
        response = await test_client.get("/health")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["status"] == "ok"


class TestTaxonomyEndpoints:
    """Tests for issue-area and domain resources."""

    @pytest.mark.asyncio
    async def test_get_full_taxonomy(self, test_client: object) -> None:
        """Test getting full taxonomy."""
        response = await test_client.get("/api/domains")
        assert response.status_code == STATUS_OK
        data = response.json()

        assert len(data["items"]) == EXPECTED_DOMAIN_COUNT
        slugs = {item["slug"] for item in data["items"]}
        assert "economic-security" in slugs
        assert "labor-and-worker-power" in slugs

    @pytest.mark.asyncio
    async def test_get_domain_issues(self, test_client: object) -> None:
        """Test getting issues for a domain."""
        response = await test_client.get("/api/domains/economic-security")
        assert response.status_code == STATUS_OK
        data = response.json()

        assert data["slug"] == "economic-security"
        assert len(data["issue_areas"]) == EXPECTED_ECONOMIC_SECURITY_ISSUES
        slugs = {item["slug"] for item in data["issue_areas"]}
        assert "worker_cooperatives" not in slugs  # Different domain

    @pytest.mark.asyncio
    async def test_get_invalid_domain(self, test_client: object) -> None:
        """Test getting invalid domain returns 404."""
        response = await test_client.get("/api/domains/invalid-domain")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_query_issue_areas(self, test_client: object) -> None:
        """Test filtering issue areas as a collection resource."""
        response = await test_client.get("/api/issue-areas?query=housing")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["items"]
        assert any(item["slug"] == "housing_affordability" for item in data["items"])


class TestEntityEndpoints:
    """Tests for entity endpoints."""

    @pytest.mark.asyncio
    async def test_create_entity(self, test_client: object) -> None:
        """Test creating an entity."""
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
        assert response.status_code == STATUS_CREATED
        data = response.json()
        assert data["name"] == "Test Org"
        assert data["address"]["state"] == "MO"
        assert data["address"]["full_address"] == "123 Main St, Kansas City, MO 64106"
        assert data["issue_area_ids"] == ["housing_affordability"]

    @pytest.mark.asyncio
    async def test_create_entity_invalid_issue_area(self, test_client: object) -> None:
        """Test creating entity with invalid issue area."""
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
        assert response.status_code == STATUS_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_list_entities(self, test_client: object, test_db: object) -> None:
        """Test listing entities."""
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
        assert response.status_code == STATUS_OK
        data = response.json()
        assert len(data["items"]) >= 1
        assert "facets" in data
        assert "total" in data
        assert "next_cursor" in data
        assert "pagination" not in data

    @pytest.mark.asyncio
    async def test_list_entities_by_state(self, test_client: object, test_db: object) -> None:
        """Test listing entities filtered by state."""
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
        assert response.status_code == STATUS_OK
        data = response.json()
        assert all(entity["address"]["state"] == "MO" for entity in data["items"])

    @pytest.mark.asyncio
    async def test_get_entity(self, test_client: object, test_db: object) -> None:
        """Test getting a single entity."""
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
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["id"] == entity_id
        assert data["name"] == "Test Org"
        assert "sources" in data

    @pytest.mark.asyncio
    async def test_get_nonexistent_entity(self, test_client: object) -> None:
        """Test getting a nonexistent entity."""
        response = await test_client.get("/api/entities/nonexistent-id")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_entity(self, test_client: object, test_db: object) -> None:
        """Test updating an entity."""
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
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["name"] == "Updated Name"

    @pytest.mark.asyncio
    async def test_delete_entity(self, test_client: object, test_db: object) -> None:
        """Test deleting an entity."""
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
        assert response.status_code == STATUS_NO_CONTENT


class TestDiscoveryRunEndpoints:
    """Tests for discovery-run resource endpoints."""

    @pytest.mark.asyncio
    async def test_start_discovery_run(self, test_client: object) -> None:
        """Test starting a discovery run."""
        response = await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["housing_affordability", "worker_cooperatives"],
            },
        )
        assert response.status_code == STATUS_ACCEPTED
        data = response.json()
        assert data["state"] == "MO"
        assert data["status"] == "running"

    @pytest.mark.asyncio
    async def test_start_discovery_run_invalid_issue_area(self, test_client: object) -> None:
        """Test starting discovery run with invalid issue area."""
        response = await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Test City, TS",
                "state": "TS",
                "issue_areas": ["invalid_issue"],
            },
        )
        assert response.status_code == STATUS_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_list_discovery_runs(self, test_client: object) -> None:
        """Test listing discovery runs."""
        # Create a run
        await test_client.post(
            "/api/discovery-runs",
            json={
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["housing_affordability"],
            },
        )

        response = await test_client.get("/api/discovery-runs")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert len(data["items"]) >= 1
        assert "total" in data
        assert "next_cursor" in data

    @pytest.mark.asyncio
    async def test_get_discovery_run(self, test_client: object) -> None:
        """Test getting a discovery run."""
        # Create a run
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
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["id"] == run_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_discovery_run(self, test_client: object) -> None:
        """Test getting a nonexistent discovery run."""
        response = await test_client.get("/api/discovery-runs/nonexistent")
        assert response.status_code == STATUS_NOT_FOUND
