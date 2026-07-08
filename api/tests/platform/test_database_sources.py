"""Database and CRUD tests."""

from __future__ import annotations

import pytest

from atlas.models import EntryCRUD, SourceCRUD


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

        entry, sources = await EntryCRUD.get_with_sources(test_db, sample_entry)
        assert entry is not None
        assert len(sources) >= 1
