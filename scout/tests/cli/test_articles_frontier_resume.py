"""Scout article frontier resume and queue CLI tests."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main
from atlas_scout.store import ScoutStore

from .articles_commands_support import _article_html, _write_config

if TYPE_CHECKING:
    from pathlib import Path


@respx.mock
def test_articles_crawl_can_resume_persisted_frontier_without_seed(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    article_url = "https://resume-news.test/2024/05/10/frontier-story"
    article_body = (
        "Nora Patel and Community Builders Dallas opened a neighborhood fund in Dallas. "
        "Civic leaders in North Texas said the project would support families. "
    ) * 32

    async def seed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": article_url,
                        "seed_url": "https://resume-news.test/sitemap.xml",
                        "depth": 1,
                        "priority": 10,
                        "source_domain": "resume-news.test",
                    }
                ]
            )
        finally:
            await store.close()

    asyncio.run(seed_frontier())
    respx.get(article_url).mock(
        return_value=httpx.Response(
            200,
            html=_article_html(
                "Nora Patel expands Dallas civic network",
                article_body,
                published_at="2024-05-10T13:30:00Z",
            ),
        )
    )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "crawl",
            "--resume-frontier",
            "--target-count",
            "1",
            "--max-pages",
            "1",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["frontier_claimed"] == 1
    assert payload["frontier_saved"] == 0
    assert payload["saved"] == 1

    store = ScoutStore(str(db_path))
    asyncio.run(store.initialize())
    try:
        frontier_stats = asyncio.run(store.article_frontier_stats())
    finally:
        asyncio.run(store.close())
    assert frontier_stats["fetched"] == 1
    assert frontier_stats["pending"] == 0


@respx.mock
def test_articles_crawl_claims_resume_frontier_in_worker_sized_batches(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    article_urls = [
        f"https://parallel-news.test/2024/05/1{index}/frontier-story" for index in range(3)
    ]
    article_body = (
        "Maya Singh and Neighborhood Builders briefed Dallas organizers on housing policy. "
        "Residents and civic leaders said the coalition would publish public updates. "
    ) * 32

    async def seed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": article_url,
                        "seed_url": "https://parallel-news.test/sitemap.xml",
                        "depth": 1,
                        "priority": 10,
                        "source_domain": "parallel-news.test",
                    }
                    for article_url in article_urls
                ]
            )
        finally:
            await store.close()

    asyncio.run(seed_frontier())
    for article_url in article_urls:
        respx.get(article_url).mock(
            return_value=httpx.Response(
                200,
                html=_article_html(
                    "Maya Singh expands Dallas housing coalition",
                    article_body,
                    published_at="2024-05-10T13:30:00Z",
                ),
            )
        )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "crawl",
            "--resume-frontier",
            "--target-count",
            "1",
            "--max-pages",
            "3",
            "--frontier-claim-size",
            "2",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    async def frontier_stats() -> dict[str, object]:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            return await store.article_frontier_stats()
        finally:
            await store.close()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["frontier_claimed"] == 2
    assert payload["fetched"] == 1
    assert payload["saved"] == 1

    stats = asyncio.run(frontier_stats())
    assert stats["fetched"] == 1
    assert stats["pending"] == 2
    assert stats["claimed"] == 0


def test_articles_frontier_stats_reports_persisted_resume_queue(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"

    async def seed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": "https://news.test/2024/05/10/city-council-vote",
                        "seed_url": "https://news.test/sitemap.xml",
                        "depth": 1,
                        "priority": 10,
                        "source_domain": "news.test",
                    }
                ]
            )
        finally:
            await store.close()

    asyncio.run(seed_frontier())

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "frontier",
            "stats",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["pending"] == 1
    assert payload["by_source_domain"] == {"news.test": 1}


def test_articles_frontier_release_claims_clears_named_worker_leases(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    article_url = "https://release-news.test/2024/05/10/city-council-vote"

    async def seed_claimed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": article_url,
                        "seed_url": "https://release-news.test/sitemap.xml",
                        "depth": 1,
                        "priority": 10,
                        "source_domain": "release-news.test",
                    }
                ]
            )
            await store.claim_article_frontier_batch(
                limit=1,
                max_per_domain=1,
                blocked_domains=set(),
                existing_article_urls=set(),
                worker_id="articles-crawl:12345:deadbeef",
                lease_seconds=900,
            )
        finally:
            await store.close()

    asyncio.run(seed_claimed_frontier())

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "frontier",
            "release-claims",
            "--worker-id",
            "articles-crawl:12345:deadbeef",
            "--json",
        ],
    )

    async def frontier_stats() -> dict[str, object]:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            return await store.article_frontier_stats()
        finally:
            await store.close()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["released"] == 1

    stats = asyncio.run(frontier_stats())
    assert stats["pending"] == 1
    assert stats["claimed"] == 0


def test_articles_frontier_reprioritize_repairs_existing_pending_queue(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    article_url = "https://news.test/2024/05/10/city-council-vote"
    topic_url = "https://news.test/news/types/opinion"

    async def seed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": topic_url,
                        "seed_url": "https://news.test/sitemap.xml",
                        "depth": 1,
                        "priority": 10,
                        "source_domain": "news.test",
                    },
                    {
                        "url": article_url,
                        "seed_url": "https://news.test/sitemap.xml",
                        "depth": 1,
                        "priority": 10,
                        "source_domain": "news.test",
                    },
                ]
            )
        finally:
            await store.close()

    asyncio.run(seed_frontier())

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "frontier",
            "reprioritize",
            "--json",
        ],
    )

    async def claim_frontier() -> list[str]:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            claimed = await store.claim_article_frontier_batch(
                limit=2,
                max_per_domain=2,
                blocked_domains=set(),
                existing_article_urls=set(),
            )
            return [str(item["url"]) for item in claimed]
        finally:
            await store.close()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["pending"] == 2
    assert payload["updated"] == 2
    assert asyncio.run(claim_frontier()) == [article_url, topic_url]
