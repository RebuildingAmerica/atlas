"""Scout article frontier expansion CLI tests."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main
from atlas_scout.store import ScoutStore

from .articles_commands_support import _write_config

if TYPE_CHECKING:
    from pathlib import Path


def test_articles_frontier_seed_persists_source_seeds_for_resume_crawls(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    seed_file = tmp_path / "seeds.txt"
    seed_file.write_text(
        "\n".join(
            [
                "# source seeds",
                "https://news-a.test/robots.txt",
                "https://news-b.test/sitemap.xml",
                "https://news-a.test/robots.txt",
            ]
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "frontier",
            "seed",
            "--seed-file",
            str(seed_file),
            "--seed",
            "https://news-c.test/sitemap.xml",
            "--json",
        ],
    )

    async def claim_frontier() -> list[str]:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            claimed = await store.claim_article_frontier_batch(
                limit=10,
                max_per_domain=1,
                blocked_domains=set(),
                existing_article_urls=set(),
            )
            return [str(item["url"]) for item in claimed]
        finally:
            await store.close()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["attempted"] == 4
    assert payload["saved"] == 3
    assert payload["pending"] == 3
    assert asyncio.run(claim_frontier()) == [
        "https://news-a.test/robots.txt",
        "https://news-b.test/sitemap.xml",
        "https://news-c.test/sitemap.xml",
    ]


@respx.mock
def test_articles_frontier_expand_turns_sitemaps_into_pending_article_work(
    tmp_path: Path,
) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    existing_article_url = "https://news.test/2024/05/10/already-pending"
    sitemap_url = "https://news.test/sitemap.xml"
    child_sitemap_url = "https://news.test/sitemaps/2024.xml"
    discovered_article_url = "https://news.test/2024/05/11/civic-network"
    stale_article_url = "https://news.test/2002/05/11/old-story"
    already_fetched_sitemap_url = "https://other-news.test/sitemap.xml"

    async def seed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": existing_article_url,
                        "seed_url": sitemap_url,
                        "depth": 1,
                        "priority": 100,
                        "source_domain": "news.test",
                    },
                    {
                        "url": sitemap_url,
                        "seed_url": sitemap_url,
                        "depth": 0,
                        "priority": 0,
                        "source_domain": "news.test",
                    },
                    {
                        "url": already_fetched_sitemap_url,
                        "seed_url": already_fetched_sitemap_url,
                        "depth": 0,
                        "priority": 0,
                        "source_domain": "other-news.test",
                    },
                ]
            )
            await store.mark_article_frontier_fetched([already_fetched_sitemap_url])
        finally:
            await store.close()

    asyncio.run(seed_frontier())
    respx.get(sitemap_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text=(
                '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<sitemap><loc>{child_sitemap_url}</loc></sitemap>"
                f"<url><loc>{discovered_article_url}</loc></url>"
                f"<url><loc>{stale_article_url}</loc></url>"
                "</sitemapindex>"
            ),
        )
    )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "frontier",
            "expand",
            "--limit",
            "10",
            "--from-date",
            "2024-01-01",
            "--to-date",
            "2024-12-31",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    async def frontier_rows() -> list[dict[str, object]]:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            return await store.list_article_frontier_pending(limit=10)
        finally:
            await store.close()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["claimed"] == 1
    assert payload["fetched"] == 1
    assert payload["frontier_saved"] == 2
    assert payload["pruned_by_date"] == 1

    pending_urls = [str(row["url"]) for row in asyncio.run(frontier_rows())]
    assert pending_urls == [existing_article_url, discovered_article_url, child_sitemap_url]


@respx.mock
def test_articles_frontier_expand_reaches_source_rows_behind_article_backlog(
    tmp_path: Path,
) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    sitemap_url = "https://backlog-news.test/sitemap.xml"
    discovered_article_url = "https://backlog-news.test/2024/05/11/civic-network"

    async def seed_frontier() -> None:
        store = ScoutStore(str(db_path))
        await store.initialize()
        try:
            await store.upsert_article_frontier(
                [
                    {
                        "url": f"https://article-backlog.test/2024/05/{index:02d}/story",
                        "seed_url": "https://article-backlog.test/sitemap.xml",
                        "depth": 2,
                        "priority": 100,
                        "source_domain": "article-backlog.test",
                    }
                    for index in range(1, 102)
                ]
                + [
                    {
                        "url": sitemap_url,
                        "seed_url": sitemap_url,
                        "depth": 0,
                        "priority": 0,
                        "source_domain": "backlog-news.test",
                    }
                ]
            )
        finally:
            await store.close()

    asyncio.run(seed_frontier())
    respx.get(sitemap_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text=(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<url><loc>{discovered_article_url}</loc></url>"
                "</urlset>"
            ),
        )
    )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "frontier",
            "expand",
            "--limit",
            "1",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["claimed"] == 1
    assert payload["fetched"] == 1
    assert payload["frontier_saved"] == 1
