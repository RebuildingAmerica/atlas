"""Article stats consistency tests."""

import json
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import atlas_scout.article_stats_runtime as stats_runtime
from atlas_scout.article_frontier import article_frontier_item
from atlas_scout.article_stats_runtime import load_article_stats
from atlas_scout.store import ScoutStore


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]] | None = None, row: dict[str, Any] | None = None):
        self._rows = rows or []
        self._row = row
        self._index = 0

    async def __aenter__(self) -> "_Cursor":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def __aiter__(self) -> AsyncIterator[dict[str, Any]]:
        return self

    async def __anext__(self) -> dict[str, Any]:
        if self._index >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._index]
        self._index += 1
        return row

    async def fetchone(self) -> dict[str, Any] | None:
        return self._row


class _StatsConnection:
    def __init__(self) -> None:
        self.rows = [
            _article_row("https://example.test/a", "Story A"),
            _article_row("https://example.test/b", "Story B"),
        ]

    def execute(self, sql: str, _params: tuple[object, ...] = ()) -> _Cursor:
        if "COUNT(DISTINCT url)" in sql:
            return _Cursor(row={"unique_article_urls": 1})
        if "SELECT * FROM articles" in sql:
            return _Cursor(rows=self.rows)
        if "duplicate_groups" in sql:
            return _Cursor(row={"duplicate_groups": 0, "duplicate_surplus": 0})
        raise AssertionError(f"unexpected SQL: {sql}")


def _article_row(url: str, title: str) -> dict[str, Any]:
    return {
        "url": url,
        "title": title,
        "published_at": "2026-07-01T12:00:00Z",
        "source_domain": "example.test",
        "provider": "crawl",
        "provider_id": url,
        "metadata": json.dumps(
            {
                "discovery_method": "crawl",
                "seed_url": "https://example.test/sitemap.xml",
                "publication": "Example Test",
                "mentions": [{"name": title, "type": "text"}],
            }
        ),
    }


async def test_article_stats_counts_unique_urls_from_reported_rows() -> None:
    store = ScoutStore(":memory:")
    store._conn = _StatsConnection()  # type: ignore[assignment]

    stats = await store.article_stats()

    assert stats["total_articles"] == 2
    assert stats["unique_article_urls"] == 2
    assert stats["duplicate_url_count"] == 0


async def test_load_article_stats_uses_existing_schema_without_writes(monkeypatch: Any) -> None:
    initialize_flags: list[bool] = []

    class RecordingStore:
        def __init__(self, _path: str) -> None:
            return None

        async def initialize(self, *, create_schema: bool = True) -> None:
            initialize_flags.append(create_schema)

        async def article_stats(self) -> dict[str, object]:
            return {"total_articles": 0}

        async def close(self) -> None:
            return None

    monkeypatch.setattr("atlas_scout.store.ScoutStore", RecordingStore)
    config = SimpleNamespace(store=SimpleNamespace(path="existing.db"))

    stats = await load_article_stats(config)  # type: ignore[arg-type]

    assert stats == {"total_articles": 0}
    assert initialize_flags == [False]


async def test_article_status_counts_use_sql_aggregates(tmp_db_path: object) -> None:
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                _stored_article("https://example.test/2026/07/01/story-a", "Story A"),
                _stored_article("https://example.test/2026/07/02/story-b", "Story B"),
            ]
        )
        await store.upsert_article_frontier(
            [
                article_frontier_item(
                    url="https://example.test/2026/07/03/story-c",
                    seed_url="https://example.test/sitemap.xml",
                    depth=1,
                ),
                article_frontier_item(
                    url="https://example.test/2026/07/04/story-d",
                    seed_url="https://example.test/sitemap.xml",
                    depth=1,
                ),
            ]
        )
        await store.mark_article_frontier_fetched(["https://example.test/2026/07/04/story-d"])

        status = await store.article_status_counts()

        assert status["total_articles"] == 2
        assert status["unique_article_urls"] == 2
        assert status["duplicate_url_count"] == 0
        assert status["articles_with_mentions"] == 2
        assert status["crawl_articles"] == 2
        assert status["crawl_discovered_articles"] == 2
        assert status["frontier_pending"] == 1
        assert status["frontier_fetched"] == 1
        assert status["frontier_total"] == 2
        assert status["frontier_claimed"] == 0
    finally:
        await store.close()


async def test_load_article_status_uses_existing_schema_without_writes(monkeypatch: Any) -> None:
    initialize_flags: list[bool] = []

    class RecordingStore:
        def __init__(self, _path: str) -> None:
            return None

        async def initialize(self, *, create_schema: bool = True) -> None:
            initialize_flags.append(create_schema)

        async def article_status_counts(self) -> dict[str, object]:
            return {"total_articles": 0, "frontier_total": 0}

        async def close(self) -> None:
            return None

    monkeypatch.setattr("atlas_scout.store.ScoutStore", RecordingStore)
    config = SimpleNamespace(store=SimpleNamespace(path="existing.db"))

    status = await stats_runtime.load_article_status(config)  # type: ignore[arg-type]

    assert status == {"total_articles": 0, "frontier_total": 0}
    assert initialize_flags == [False]


def _stored_article(url: str, title: str) -> dict[str, Any]:
    return {
        "url": url,
        "title": title,
        "published_at": "2026-07-01T12:00:00Z",
        "source_name": "Example Test",
        "source_domain": "example.test",
        "section": "news",
        "provider": "crawl",
        "provider_id": url,
        "api_url": None,
        "metadata": {
            "discovery_method": "crawl",
            "seed_url": "https://example.test/sitemap.xml",
            "publication": "Example Test",
            "mentions": [{"name": title, "type": "text"}],
        },
    }
