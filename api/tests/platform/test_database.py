"""Database and CRUD tests."""

from datetime import date

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

    @pytest.mark.asyncio
    async def test_entry_with_full_address(self, test_db: object) -> None:
        """Test creating an organization entry with a full address."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Addressable Org",
            description="Has a public mailing address.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            full_address="123 Main St, Kansas City, MO 64106",
        )

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is not None
        assert entry.full_address == "123 Main St, Kansas City, MO 64106"

    @pytest.mark.asyncio
    async def test_entry_to_dict_can_hide_internal_fields(self, test_db: object) -> None:
        """Public entry serialization should omit internal editorial fields when requested."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Public View Org",
            description="Used to verify public Atlas serialization.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            editorial_notes="For staff only.",
            priority="high",
        )

        entry = await EntryCRUD.get_by_id(test_db, entry_id)
        assert entry is not None

        public_record = entry.to_dict(include_internal=False)

        assert "contact_status" not in public_record
        assert "editorial_notes" not in public_record
        assert "priority" not in public_record

    @pytest.mark.asyncio
    async def test_list_entries_can_filter_by_city_without_state(self, test_db: object) -> None:
        """City-only filtering should work without requiring a state filter."""
        kansas_city_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Kansas City Housing Org",
            description="Kansas City org.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        st_louis_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="St. Louis Housing Org",
            description="St. Louis org.",
            city="St. Louis",
            state="MO",
            geo_specificity="local",
        )

        entries = await EntryCRUD.list(test_db, city="Kansas City")

        entry_ids = {entry.id for entry in entries}
        assert kansas_city_id in entry_ids
        assert st_louis_id not in entry_ids


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


class TestSourceModelCoverage:
    """Coverage-focused tests for SourceCRUD edges and SourceModel.to_dict."""

    @pytest.mark.asyncio
    async def test_to_dict_serializes_fields_including_published_date(
        self, test_db: object
    ) -> None:
        """SourceModel.to_dict should ISO-encode dates and round-trip all fields."""
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/article-dict",
            source_type="news_article",
            extraction_method="manual",
            title="Dict Test",
            publication="Atlas Today",
            published_date=date(2026, 3, 1),
            raw_content="raw html",
        )
        source = await SourceCRUD.get_by_id(test_db, source_id)
        assert source is not None
        payload = source.to_dict()
        assert payload["id"] == source_id
        assert payload["url"] == "https://example.com/article-dict"
        assert payload["title"] == "Dict Test"
        assert payload["publication"] == "Atlas Today"
        assert payload["published_date"] == "2026-03-01"
        assert payload["type"] == "news_article"
        assert payload["extraction_method"] == "manual"
        assert payload["raw_content"] == "raw html"

    @pytest.mark.asyncio
    async def test_to_dict_handles_missing_published_date(self, test_db: object) -> None:
        """to_dict should emit None when no published_date is set."""
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/article-undated",
            source_type="news_article",
            extraction_method="manual",
        )
        source = await SourceCRUD.get_by_id(test_db, source_id)
        assert source is not None
        assert source.to_dict()["published_date"] is None

    @pytest.mark.asyncio
    async def test_list_filters_by_source_type(self, test_db: object) -> None:
        """list should filter by source_type when provided."""
        news_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/news-1",
            source_type="news_article",
            extraction_method="manual",
        )
        await SourceCRUD.create(
            test_db,
            url="https://example.com/podcast-1",
            source_type="podcast",
            extraction_method="manual",
        )
        results = await SourceCRUD.list(test_db, source_type="news_article")
        ids = {s.id for s in results}
        assert news_id in ids
        assert all(s.type == "news_article" for s in results)

    @pytest.mark.asyncio
    async def test_create_accepts_community_archive_source_type(self, test_db: object) -> None:
        """Community-source evidence should persist as a first-class source type."""
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.org/community-calendar",
            source_type="community_archive",
            extraction_method="autodiscovery",
        )

        source = await SourceCRUD.get_by_id(test_db, source_id)

        assert source is not None
        assert source.type == "community_archive"

    @pytest.mark.asyncio
    async def test_list_filters_by_extraction_method(self, test_db: object) -> None:
        """list should filter by extraction_method when provided."""
        await SourceCRUD.create(
            test_db,
            url="https://example.com/manual",
            source_type="news_article",
            extraction_method="manual",
        )
        auto_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/auto",
            source_type="news_article",
            extraction_method="autodiscovery",
        )
        results = await SourceCRUD.list(test_db, extraction_method="autodiscovery")
        ids = {s.id for s in results}
        assert auto_id in ids
        assert all(s.extraction_method == "autodiscovery" for s in results)

    @pytest.mark.asyncio
    async def test_list_returns_empty_when_no_matches(self, test_db: object) -> None:
        """list should return [] when no sources match the filter."""
        results = await SourceCRUD.list(test_db, source_type="podcast")
        assert results == []

    @pytest.mark.asyncio
    async def test_update_returns_false_when_no_allowed_fields(
        self, test_db: object, sample_source: str
    ) -> None:
        """update should short-circuit to False if no allowed fields are passed."""
        success = await SourceCRUD.update(test_db, sample_source, ignored_field="x")
        assert success is False

    @pytest.mark.asyncio
    async def test_update_serializes_published_date(
        self, test_db: object, sample_source: str
    ) -> None:
        """update should ISO-encode date instances stored in the published_date field."""
        success = await SourceCRUD.update(test_db, sample_source, published_date=date(2026, 4, 5))
        assert success is True
        source = await SourceCRUD.get_by_id(test_db, sample_source)
        assert source is not None
        assert source.published_date == date(2026, 4, 5)

    @pytest.mark.asyncio
    async def test_unlink_from_entry_removes_link(
        self, test_db: object, sample_entry: str, sample_source: str
    ) -> None:
        """unlink_from_entry should remove an existing link and report success."""
        await SourceCRUD.link_to_entry(test_db, sample_entry, sample_source)
        removed = await SourceCRUD.unlink_from_entry(test_db, sample_entry, sample_source)
        assert removed is True

    @pytest.mark.asyncio
    async def test_unlink_from_entry_returns_false_when_no_link(
        self, test_db: object, sample_entry: str, sample_source: str
    ) -> None:
        """unlink_from_entry should return False if no link existed."""
        removed = await SourceCRUD.unlink_from_entry(test_db, sample_entry, sample_source)
        assert removed is False

    @pytest.mark.asyncio
    async def test_get_by_url_returns_none_when_missing(self, test_db: object) -> None:
        """get_by_url should return None when no row matches."""
        result = await SourceCRUD.get_by_url(test_db, "https://does-not-exist.example/x")
        assert result is None
