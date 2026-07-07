"""Article frontier persistence tests for ScoutStore."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest

from atlas_scout.store import ScoutStore


@pytest.fixture
async def store(tmp_db_path: object) -> AsyncIterator[ScoutStore]:
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    yield s
    await s.close()


async def test_article_frontier_persists_and_claims_domain_balanced_batches(
    store: ScoutStore,
) -> None:
    saved = await store.upsert_article_frontier(
        [
            {
                "url": "https://example.com/2026/07/01/story-a",
                "seed_url": "https://example.com/sitemap.xml",
                "depth": 1,
                "priority": 10,
                "source_domain": "example.com",
            },
            {
                "url": "https://example.com/2026/07/01/story-b",
                "seed_url": "https://example.com/sitemap.xml",
                "depth": 1,
                "priority": 10,
                "source_domain": "example.com",
            },
            {
                "url": "https://other.test/2026/07/01/story",
                "seed_url": "https://other.test/robots.txt",
                "depth": 1,
                "priority": 5,
                "source_domain": "other.test",
            },
        ]
    )

    first_batch = await store.claim_article_frontier_batch(
        limit=3,
        max_per_domain=1,
        blocked_domains=set(),
        existing_article_urls=set(),
    )
    await store.mark_article_frontier_fetched([item["url"] for item in first_batch])
    second_batch = await store.claim_article_frontier_batch(
        limit=10,
        max_per_domain=10,
        blocked_domains=set(),
        existing_article_urls=set(),
    )
    await store.mark_article_frontier_fetched([item["url"] for item in second_batch])
    stats = await store.article_frontier_stats()

    assert saved == {"attempted": 3, "saved": 3, "skipped": 0}
    assert [item["url"] for item in first_batch] == [
        "https://example.com/2026/07/01/story-a",
        "https://other.test/2026/07/01/story",
    ]
    assert [item["url"] for item in second_batch] == [
        "https://example.com/2026/07/01/story-b",
    ]
    assert stats == {
        "pending": 0,
        "fetched": 3,
        "skipped": 0,
        "claimed": 0,
        "by_source_domain": {},
    }


async def test_article_frontier_claim_limits_each_domain_per_claim_batch(
    store: ScoutStore,
) -> None:
    dominant_items = [
        {
            "url": f"https://dominant.test/2026/07/{day:02d}/story",
            "seed_url": "https://dominant.test/sitemap.xml",
            "depth": 1,
            "priority": 10,
            "source_domain": "dominant.test",
        }
        for day in range(1, 8)
    ]
    await store.upsert_article_frontier(
        [
            *dominant_items,
            {
                "url": "https://other.test/2026/07/01/story",
                "seed_url": "https://other.test/sitemap.xml",
                "depth": 1,
                "priority": 10,
                "source_domain": "other.test",
            },
        ]
    )

    claimed = await store.claim_article_frontier_batch(
        limit=8,
        max_per_domain=2,
        blocked_domains=set(),
        existing_article_urls=set(),
    )

    claimed_by_domain: dict[str, int] = {}
    for item in claimed:
        domain = str(item["source_domain"])
        claimed_by_domain[domain] = claimed_by_domain.get(domain, 0) + 1
    assert claimed_by_domain == {"dominant.test": 2, "other.test": 1}


async def test_article_frontier_claims_are_leased_between_workers(store: ScoutStore) -> None:
    urls = [
        "https://leased.test/2026/07/01/story-a",
        "https://leased.test/2026/07/01/story-b",
    ]
    await store.upsert_article_frontier(
        [
            {
                "url": url,
                "seed_url": "https://leased.test/sitemap.xml",
                "depth": 1,
                "priority": 10,
                "source_domain": "leased.test",
            }
            for url in urls
        ]
    )

    first_worker = await store.claim_article_frontier_batch(
        limit=2,
        max_per_domain=2,
        blocked_domains=set(),
        existing_article_urls=set(),
        worker_id="worker-a",
        lease_seconds=300,
    )
    second_worker = await store.claim_article_frontier_batch(
        limit=2,
        max_per_domain=2,
        blocked_domains=set(),
        existing_article_urls=set(),
        worker_id="worker-b",
        lease_seconds=300,
    )
    stats_after_claim = await store.article_frontier_stats()

    assert [str(item["url"]) for item in first_worker] == urls
    assert {str(item["claimed_by"]) for item in first_worker} == {"worker-a"}
    assert second_worker == []
    assert stats_after_claim["pending"] == 2
    assert stats_after_claim["claimed"] == 2

    assert store._conn is not None
    expired_at = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    await store._conn.execute(
        """
        UPDATE article_frontier
        SET claim_expires_at = ?
        WHERE url = ?
        """,
        (expired_at, urls[0]),
    )
    await store._conn.commit()

    reclaimed = await store.claim_article_frontier_batch(
        limit=2,
        max_per_domain=2,
        blocked_domains=set(),
        existing_article_urls=set(),
        worker_id="worker-b",
        lease_seconds=300,
    )
    stats_after_reclaim = await store.article_frontier_stats()

    assert [str(item["url"]) for item in reclaimed] == [urls[0]]
    assert str(reclaimed[0]["claimed_by"]) == "worker-b"
    assert stats_after_reclaim["claimed"] == 2


async def test_article_frontier_claim_retries_transient_begin_locks(tmp_db_path: object) -> None:
    seed_store = ScoutStore(str(tmp_db_path))
    lock_store = ScoutStore(str(tmp_db_path))
    claim_store = ScoutStore(str(tmp_db_path))
    await seed_store.initialize()
    await lock_store.initialize()
    await claim_store.initialize()
    try:
        await seed_store.upsert_article_frontier(
            [
                {
                    "url": "https://locked.test/2026/07/01/story",
                    "seed_url": "https://locked.test/sitemap.xml",
                    "depth": 1,
                    "priority": 10,
                    "source_domain": "locked.test",
                }
            ]
        )

        assert lock_store._conn is not None
        assert claim_store._conn is not None
        await claim_store._conn.execute("PRAGMA busy_timeout=1")
        await lock_store._conn.execute("BEGIN IMMEDIATE")

        async def release_lock() -> None:
            await asyncio.sleep(0.1)
            assert lock_store._conn is not None
            await lock_store._conn.rollback()

        release_task = asyncio.create_task(release_lock())
        try:
            claimed = await claim_store.claim_article_frontier_batch(
                limit=1,
                max_per_domain=1,
                blocked_domains=set(),
                existing_article_urls=set(),
                worker_id="worker-after-lock",
                lease_seconds=300,
            )
        finally:
            await release_task

        assert [str(item["url"]) for item in claimed] == ["https://locked.test/2026/07/01/story"]
    finally:
        await claim_store.close()
        await lock_store.close()
        await seed_store.close()


async def test_article_frontier_priorities_can_be_updated_for_pending_urls(
    store: ScoutStore,
) -> None:
    await store.upsert_article_frontier(
        [
            {
                "url": "https://news.test/news/types/opinion",
                "seed_url": "https://news.test/sitemap.xml",
                "depth": 1,
                "priority": 10,
                "source_domain": "news.test",
            },
            {
                "url": "https://news.test/2024/05/10/city-council-vote",
                "seed_url": "https://news.test/sitemap.xml",
                "depth": 1,
                "priority": 10,
                "source_domain": "news.test",
            },
        ]
    )

    updated = await store.update_article_frontier_priorities(
        {
            "https://news.test/news/types/opinion": 1,
            "https://news.test/2024/05/10/city-council-vote": 100,
        }
    )
    claimed = await store.claim_article_frontier_batch(
        limit=2,
        max_per_domain=2,
        blocked_domains=set(),
        existing_article_urls=set(),
    )

    assert updated == 2
    assert [item["url"] for item in claimed] == [
        "https://news.test/2024/05/10/city-council-vote",
        "https://news.test/news/types/opinion",
    ]
