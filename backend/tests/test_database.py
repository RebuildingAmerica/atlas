"""Database and CRUD tests."""

import pytest

from atlas.models import (
    DiscoveryRunCRUD,
    EntryCRUD,
    SourceCRUD,
)

# Test data constants
QUERIES_GENERATED = 100
SOURCES_FETCHED = 50
ENTRIES_EXTRACTED = 25


class TestEntryModel:
    """Tests for Entry model and CRUD."""

    @pytest.mark.asyncio
    async def test_create_entry(self, test_db: object) -> None:
        """Test creating an entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Test Org",
            description="Test description.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        assert entry_id is not None

    @pytest.mark.asyncio
    async def test_get_entry(self, test_db: object, sample_entry: object) -> None:
        """Test retrieving an entry."""
        entry = await EntryCRUD.get_by_id(test_db, sample_entry)
        assert entry is not None
        assert entry.name == "Test Organization"
        assert entry.state == "MO"

    @pytest.mark.asyncio
    async def test_list_entries(self, test_db: object, sample_entry: object) -> None:
        """Test listing entries."""
        entries = await EntryCRUD.list(test_db, state="MO")
        assert len(entries) >= 1
        assert any(e.id == sample_entry for e in entries)

    @pytest.mark.asyncio
    async def test_filter_by_state(self, test_db: object, sample_entry: object) -> None:
        """Test filtering entries by state."""
        entries = await EntryCRUD.list(test_db, state="MO")
        # sample_entry is used to ensure there's at least one MO entry
        assert len(entries) >= 1
        assert sample_entry in [e.id for e in entries]
        assert all(e.state == "MO" for e in entries)

    @pytest.mark.asyncio
    async def test_update_entry(self, test_db: object, sample_entry: object) -> None:
        """Test updating an entry."""
        success = await EntryCRUD.update(
            test_db,
            sample_entry,
            name="Updated Name",
            verified=True,
        )
        assert success

        entry = await EntryCRUD.get_by_id(test_db, sample_entry)
        assert entry is not None
        assert entry.name == "Updated Name"
        assert entry.verified is True

    @pytest.mark.asyncio
    async def test_delete_entry(self, test_db: object) -> None:
        """Test deleting an entry."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="To Delete",
            description="Will be deleted.",
            city="Test City",
            state="KS",
            geo_specificity="local",
        )

        success = await EntryCRUD.delete(test_db, entry_id)
        assert success

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is None

    @pytest.mark.asyncio
    async def test_entry_with_social_media(self, test_db: object) -> None:
        """Test creating entry with social media."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="person",
            name="Social Media Person",
            description="Has social media.",
            city="NYC",
            state="NY",
            geo_specificity="local",
            social_media={"twitter": "@user", "facebook": "user.page"},
        )

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is not None
        assert entry.social_media == {"twitter": "@user", "facebook": "user.page"}


class TestSourceModel:
    """Tests for Source model and CRUD."""

    @pytest.mark.asyncio
    async def test_create_source(self, test_db: object) -> None:
        """Test creating a source."""
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/news",
            source_type="news_article",
            extraction_method="manual",
        )
        assert source_id is not None

    @pytest.mark.asyncio
    async def test_get_source(self, test_db: object, sample_source: object) -> None:
        """Test retrieving a source."""
        source = await SourceCRUD.get_by_id(test_db, sample_source)
        assert source is not None
        assert source.url == "https://example.com/article"

    @pytest.mark.asyncio
    async def test_get_source_by_url(self, test_db: object, sample_source: object) -> None:
        """Test getting source by URL."""
        source = await SourceCRUD.get_by_url(test_db, "https://example.com/article")
        assert source is not None
        assert source.id == sample_source

    @pytest.mark.asyncio
    async def test_list_sources(self, test_db: object, sample_source: object) -> None:
        """Test listing sources."""
        # sample_source is used to ensure there's at least one source
        sources = await SourceCRUD.list(test_db)
        assert len(sources) >= 1
        assert sample_source in [s.id for s in sources]

    @pytest.mark.asyncio
    async def test_update_source(self, test_db: object, sample_source: object) -> None:
        """Test updating a source."""
        success = await SourceCRUD.update(
            test_db,
            sample_source,
            title="Updated Title",
        )
        assert success

        source = await SourceCRUD.get_by_id(test_db, sample_source)
        assert source is not None
        assert source.title == "Updated Title"

    @pytest.mark.asyncio
    async def test_delete_source(self, test_db: object) -> None:
        """Test deleting a source."""
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/to-delete",
            source_type="news_article",
            extraction_method="manual",
        )

        success = await SourceCRUD.delete(test_db, source_id)
        assert success

        source = await SourceCRUD.get_by_id(test_db, source_id)
        assert source is None

    @pytest.mark.asyncio
    async def test_link_entry_to_source(
        self, test_db: object, sample_entry: object, sample_source: object
    ) -> None:
        """Test linking an entry to a source."""
        await SourceCRUD.link_to_entry(
            test_db,
            sample_entry,
            sample_source,
            extraction_context="Relevant passage here",
        )

        # Verify link via DB query
        entry, sources = await EntryCRUD.get_with_sources(test_db, sample_entry)
        assert entry is not None
        assert len(sources) >= 1


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
        # sample_discovery_run is used to ensure there's at least one run
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
