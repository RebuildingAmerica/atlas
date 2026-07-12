"""Row-helper coverage for atlas.domains.catalog.models.source."""

from __future__ import annotations

from datetime import UTC, date, datetime

from atlas.domains.catalog.models.source import _row_to_source


def test_row_to_source_accepts_postgres_datetime_values() -> None:
    """Postgres can return DATE columns as datetime values."""
    source = _row_to_source(
        {
            "id": "source-postgres-date",
            "url": "https://example.com/source",
            "title": "Source with timestamp date",
            "publication": "Example",
            "published_date": datetime(2026, 2, 4, 10, 15, tzinfo=UTC),
            "type": "news_article",
            "ingested_at": "2026-02-05T00:00:00Z",
            "extraction_method": "manual",
            "raw_content": None,
            "created_at": "2026-02-05T00:00:00Z",
        }
    )

    assert source.published_date == date(2026, 2, 4)
