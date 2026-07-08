"""Database and CRUD tests."""

from __future__ import annotations

import pytest

from atlas.models import DiscoveryRunCRUD

QUERIES_GENERATED = 100
SOURCES_FETCHED = 50
ENTRIES_EXTRACTED = 25


class TestDiscoveryRunModel:
    """Tests for DiscoveryRun model and CRUD."""

    @pytest.mark.asyncio
    async def test_create_discovery_run(self, test_db: object) -> None:
        """Test creating a discovery run."""
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        assert run_id is not None

    @pytest.mark.asyncio
    async def test_get_discovery_run(self, test_db: object, sample_discovery_run: object) -> None:
        """Test retrieving a discovery run."""
        run = await DiscoveryRunCRUD.get_by_id(test_db, sample_discovery_run)
        assert run is not None
        assert run.state == "MO"
        assert run.status == "running"

    @pytest.mark.asyncio
    async def test_list_discovery_runs(self, test_db: object, sample_discovery_run: object) -> None:
        """Test listing discovery runs."""
        runs = await DiscoveryRunCRUD.list(test_db)
        assert len(runs) >= 1
        assert sample_discovery_run in [r.id for r in runs]

    @pytest.mark.asyncio
    async def test_complete_discovery_run(
        self, test_db: object, sample_discovery_run: object
    ) -> None:
        """Test completing a discovery run."""
        success = await DiscoveryRunCRUD.complete(
            test_db,
            sample_discovery_run,
            queries_generated=QUERIES_GENERATED,
            sources_fetched=SOURCES_FETCHED,
            entries_extracted=ENTRIES_EXTRACTED,
        )
        assert success

        run = await DiscoveryRunCRUD.get_by_id(test_db, sample_discovery_run)
        assert run is not None
        assert run.status == "completed"
        assert run.queries_generated == QUERIES_GENERATED

    @pytest.mark.asyncio
    async def test_fail_discovery_run(self, test_db: object) -> None:
        """Test failing a discovery run."""
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Test City, TS",
            state="TS",
            issue_areas=["housing_affordability"],
        )

        success = await DiscoveryRunCRUD.fail(
            test_db,
            run_id,
            error_message="API rate limit exceeded",
        )
        assert success

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert "rate limit" in run.error_message
