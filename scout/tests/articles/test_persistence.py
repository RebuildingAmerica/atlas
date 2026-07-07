"""Article persistence tests for ScoutStore."""

import asyncio
from collections.abc import AsyncIterator

import pytest

from atlas_scout.store import ScoutStore


@pytest.fixture
async def store(tmp_db_path: object) -> AsyncIterator[ScoutStore]:
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    yield s
    await s.close()


async def test_bulk_save_articles_dedupes_by_url_and_reports_stats(store: ScoutStore) -> None:
    saved = await store.bulk_save_articles(
        [
            {
                "url": "https://example.com/2006/story",
                "title": "Older article",
                "published_at": "2006-07-06T12:00:00Z",
                "source_name": "Example News",
                "source_domain": "example.com",
                "section": "World",
                "provider": "guardian",
                "provider_id": "example/older",
                "api_url": "https://content.guardianapis.com/example/older",
                "metadata": {"pillar": "News"},
            },
            {
                "url": "https://example.com/2026/story",
                "title": "Current article",
                "published_at": "2026-07-05T12:00:00Z",
                "source_name": "Example News",
                "source_domain": "example.com",
                "section": "US news",
                "provider": "guardian",
                "provider_id": "example/current",
                "api_url": "https://content.guardianapis.com/example/current",
                "metadata": {"pillar": "News"},
            },
            {
                "url": "https://example.com/2026/story",
                "title": "Current article duplicate",
                "published_at": "2026-07-05T12:00:00Z",
                "source_name": "Example News",
                "source_domain": "example.com",
                "section": "US news",
                "provider": "guardian",
                "provider_id": "example/current",
                "api_url": "https://content.guardianapis.com/example/current",
                "metadata": {"pillar": "News"},
            },
        ]
    )

    stats = await store.article_stats()
    articles = await store.list_articles()

    assert saved == {"attempted": 3, "saved": 2, "skipped": 1, "updated": 0}
    assert stats["total_articles"] == 2
    assert stats["earliest_published_at"] == "2006-07-06T12:00:00Z"
    assert stats["latest_published_at"] == "2026-07-05T12:00:00Z"
    assert stats["by_year"] == {"2006": 1, "2026": 1}
    assert stats["by_source_domain"] == {"example.com": 2}
    assert stats["by_provider"] == {"guardian": 2}
    assert [article["title"] for article in articles] == ["Current article", "Older article"]


async def test_bulk_save_articles_can_update_existing_metadata(store: ScoutStore) -> None:
    first = await store.bulk_save_articles(
        [
            {
                "url": "https://example.com/story",
                "title": "Original article",
                "published_at": "2026-07-05T12:00:00Z",
                "source_name": "Example News",
                "source_domain": "example.com",
                "section": "US news",
                "provider": "guardian",
                "provider_id": "example/story",
                "api_url": "https://content.guardianapis.com/example/story",
                "metadata": {"trail_text": "Original context."},
            }
        ]
    )
    second = await store.bulk_save_articles(
        [
            {
                "url": "https://example.com/story",
                "title": "Updated article",
                "published_at": "2026-07-05T12:00:00Z",
                "source_name": "Example News",
                "source_domain": "example.com",
                "section": "US news",
                "provider": "guardian",
                "provider_id": "example/story",
                "api_url": "https://content.guardianapis.com/example/story",
                "metadata": {
                    "trail_text": "Updated context.",
                    "mentions": [
                        {
                            "name": "Updated topic",
                            "type": "text",
                            "source": "trail_text",
                        }
                    ],
                    "pillar_name": "News",
                },
            }
        ],
        update_existing=True,
    )

    articles = await store.list_articles(limit=0)
    stats = await store.article_stats()

    assert first == {"attempted": 1, "saved": 1, "skipped": 0, "updated": 0}
    assert second == {"attempted": 1, "saved": 0, "skipped": 0, "updated": 1}
    assert len(articles) == 1
    assert articles[0]["title"] == "Updated article"
    assert articles[0]["metadata"]["trail_text"] == "Updated context."
    assert stats["articles_with_mentions"] == 1
    assert stats["metadata_complete_articles"] == 1


async def test_bulk_save_articles_retries_transient_insert_locks(tmp_db_path: object) -> None:
    lock_store = ScoutStore(str(tmp_db_path))
    article_store = ScoutStore(str(tmp_db_path))
    await lock_store.initialize()
    await article_store.initialize()
    try:
        assert lock_store._conn is not None
        assert article_store._conn is not None
        await article_store._conn.execute("PRAGMA busy_timeout=1")
        await lock_store._conn.execute("BEGIN IMMEDIATE")

        async def release_lock() -> None:
            await asyncio.sleep(0.1)
            assert lock_store._conn is not None
            await lock_store._conn.rollback()

        release_task = asyncio.create_task(release_lock())
        try:
            saved = await article_store.bulk_save_articles(
                [
                    {
                        "url": "https://locked.test/2026/07/01/saved-story",
                        "title": "Saved after transient lock",
                        "published_at": "2026-07-01T12:00:00Z",
                        "source_name": "Locked News",
                        "source_domain": "locked.test",
                        "section": "news",
                        "provider": "crawl",
                        "provider_id": "https://locked.test/2026/07/01/saved-story",
                        "api_url": None,
                        "metadata": {
                            "discovery_method": "crawl",
                            "mentions": [{"name": "Civic Leader"}],
                        },
                    }
                ]
            )
        finally:
            await release_task

        assert saved == {"attempted": 1, "saved": 1, "skipped": 0, "updated": 0}
    finally:
        await article_store.close()
        await lock_store.close()


async def test_dedupe_articles_by_title_date_removes_duplicate_signatures(
    store: ScoutStore,
) -> None:
    articles = [
        {
            "url": "https://example.com/story",
            "title": "Shared wire story",
            "published_at": "2026-07-05T12:00:00Z",
            "source_name": "Example News",
            "source_domain": "example.com",
            "section": "news",
            "provider": "crawl",
            "provider_id": "https://example.com/story",
            "api_url": None,
            "metadata": {"discovery_method": "crawl", "mentions": [{"name": "Civic Leader"}]},
        },
        {
            "url": "https://example.com/story?mod=widget",
            "title": "Shared wire story",
            "published_at": "2026-07-05T12:00:00Z",
            "source_name": "Example News",
            "source_domain": "example.com",
            "section": "news",
            "provider": "crawl",
            "provider_id": "https://example.com/story?mod=widget",
            "api_url": None,
            "metadata": {"discovery_method": "crawl", "mentions": [{"name": "Civic Leader"}]},
        },
        {
            "url": "https://wire.example.net/story",
            "title": "Shared wire story",
            "published_at": "2026-07-05T12:00:00Z",
            "source_name": "Wire News",
            "source_domain": "wire.example.net",
            "section": "news",
            "provider": "crawl",
            "provider_id": "https://wire.example.net/story",
            "api_url": None,
            "metadata": {"discovery_method": "crawl", "mentions": [{"name": "Civic Leader"}]},
        },
        {
            "url": "https://example.com/unique",
            "title": "Unique civic story",
            "published_at": "2026-07-05T13:00:00Z",
            "source_name": "Example News",
            "source_domain": "example.com",
            "section": "news",
            "provider": "crawl",
            "provider_id": "https://example.com/unique",
            "api_url": None,
            "metadata": {"discovery_method": "crawl", "mentions": [{"name": "Civic Partner"}]},
        },
    ]
    await store.bulk_save_articles(articles)

    dry_run = await store.dedupe_articles_by_title_date(dry_run=True)
    stats_before = await store.article_stats()
    deduped = await store.dedupe_articles_by_title_date(dry_run=False)
    stats_after = await store.article_stats()

    assert dry_run == {
        "duplicate_groups": 1,
        "duplicate_surplus": 2,
        "deleted": 0,
        "dry_run": True,
    }
    assert stats_before["total_articles"] == 4
    assert deduped == {
        "duplicate_groups": 1,
        "duplicate_surplus": 2,
        "deleted": 2,
        "dry_run": False,
    }
    assert stats_after["total_articles"] == 2
    assert stats_after["semantic_duplicate_groups"] == 0
    assert stats_after["semantic_duplicate_surplus"] == 0
