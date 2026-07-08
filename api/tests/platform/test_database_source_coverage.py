"""Database and CRUD tests."""

from __future__ import annotations

from datetime import date

import pytest

from atlas.models import SourceCRUD


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
