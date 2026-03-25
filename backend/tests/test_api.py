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
    """Tests for taxonomy endpoints."""

    @pytest.mark.asyncio
    async def test_get_full_taxonomy(self, test_client: object) -> None:
        """Test getting full taxonomy."""
        response = await test_client.get("/api/v1/taxonomy")
        assert response.status_code == STATUS_OK
        data = response.json()

        # Check that we have all domains
        assert len(data) == EXPECTED_DOMAIN_COUNT
        assert "Economic Security" in data
        assert "Labor and Worker Power" in data

    @pytest.mark.asyncio
    async def test_get_domain_issues(self, test_client: object) -> None:
        """Test getting issues for a domain."""
        response = await test_client.get("/api/v1/taxonomy/Economic%20Security")
        assert response.status_code == STATUS_OK
        data = response.json()

        # Should have issues in Economic Security
        assert len(data) == EXPECTED_ECONOMIC_SECURITY_ISSUES
        slugs = {item["slug"] for item in data}
        assert "worker_cooperatives" not in slugs  # Different domain

    @pytest.mark.asyncio
    async def test_get_invalid_domain(self, test_client: object) -> None:
        """Test getting invalid domain returns 404."""
        response = await test_client.get("/api/v1/taxonomy/InvalidDomain")
        assert response.status_code == STATUS_NOT_FOUND


class TestEntryEndpoints:
    """Tests for entry endpoints."""

    @pytest.mark.asyncio
    async def test_create_entry(self, test_client: object) -> None:
        """Test creating an entry."""
        response = await test_client.post(
            "/api/v1/entries",
            json={
                "type": "organization",
                "name": "Test Org",
                "description": "A test organization.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
            },
        )
        assert response.status_code == STATUS_CREATED
        data = response.json()
        assert data["name"] == "Test Org"
        assert data["state"] == "MO"

    @pytest.mark.asyncio
    async def test_create_entry_invalid_issue_area(self, test_client: object) -> None:
        """Test creating entry with invalid issue area."""
        response = await test_client.post(
            "/api/v1/entries",
            json={
                "type": "organization",
                "name": "Test",
                "description": "Test.",
                "city": "Test",
                "state": "TS",
                "geo_specificity": "local",
                "issue_areas": ["invalid_issue_area"],
            },
        )
        assert response.status_code == STATUS_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_list_entries(self, test_client: object, test_db: object) -> None:
        """Test listing entries."""
        # Create an entry first
        await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Test Org",
            description="Test.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )

        response = await test_client.get("/api/v1/entries")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert len(data) >= 1

    @pytest.mark.asyncio
    async def test_list_entries_by_state(self, test_client: object, test_db: object) -> None:
        """Test listing entries filtered by state."""
        # Create entries in different states
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

        response = await test_client.get("/api/v1/entries?state=MO")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert all(entry["state"] == "MO" for entry in data)

    @pytest.mark.asyncio
    async def test_get_entry(self, test_client: object, test_db: object) -> None:
        """Test getting a single entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Test Org",
            description="Test.",
            city="Test City",
            state="TS",
            geo_specificity="local",
        )

        response = await test_client.get(f"/api/v1/entries/{entry_id}")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["id"] == entry_id
        assert data["name"] == "Test Org"

    @pytest.mark.asyncio
    async def test_get_nonexistent_entry(self, test_client: object) -> None:
        """Test getting a nonexistent entry."""
        response = await test_client.get("/api/v1/entries/nonexistent-id")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_entry(self, test_client: object, test_db: object) -> None:
        """Test updating an entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Original Name",
            description="Test.",
            city="Test",
            state="TS",
            geo_specificity="local",
        )

        response = await test_client.patch(
            f"/api/v1/entries/{entry_id}",
            json={"name": "Updated Name"},
        )
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["name"] == "Updated Name"

    @pytest.mark.asyncio
    async def test_delete_entry(self, test_client: object, test_db: object) -> None:
        """Test deleting an entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="To Delete",
            description="Test.",
            city="Test",
            state="TS",
            geo_specificity="local",
        )

        response = await test_client.delete(f"/api/v1/entries/{entry_id}")
        assert response.status_code == STATUS_NO_CONTENT


class TestDiscoveryEndpoints:
    """Tests for discovery run endpoints."""

    @pytest.mark.asyncio
    async def test_start_discovery_run(self, test_client: object) -> None:
        """Test starting a discovery run."""
        response = await test_client.post(
            "/api/v1/discovery/run",
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
            "/api/v1/discovery/run",
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
            "/api/v1/discovery/run",
            json={
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["housing_affordability"],
            },
        )

        response = await test_client.get("/api/v1/discovery/runs")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert len(data) >= 1

    @pytest.mark.asyncio
    async def test_get_discovery_run(self, test_client: object) -> None:
        """Test getting a discovery run."""
        # Create a run
        create_response = await test_client.post(
            "/api/v1/discovery/run",
            json={
                "location_query": "Test City, TS",
                "state": "TS",
                "issue_areas": ["housing_affordability"],
            },
        )
        run_id = create_response.json()["id"]

        response = await test_client.get(f"/api/v1/discovery/runs/{run_id}")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert data["id"] == run_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_discovery_run(self, test_client: object) -> None:
        """Test getting a nonexistent discovery run."""
        response = await test_client.get("/api/v1/discovery/runs/nonexistent")
        assert response.status_code == STATUS_NOT_FOUND
