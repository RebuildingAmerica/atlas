"""Scout article crawl CLI tests."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main

from .articles_commands_support import _article_html, _write_config

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from atlas_scout.store import ScoutStore


@respx.mock
def test_articles_crawl_saves_crawl_discovered_article_records(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    seed_url = "https://example-news.test/"
    article_url = "https://example-news.test/2024/05/10/housing-drive"
    respx.get(seed_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head><title>Example News</title></head><body>"
                f'<a href="{article_url}">Housing drive</a>'
                '<a href="https://example-news.test/about">About</a>'
                "</body></html>"
            ),
        )
    )
    article_body = (
        "Maria Lopez and United Way Nevada opened a housing drive in Las Vegas. "
        "Clark County officials said the civic project would support families. "
    ) * 35
    respx.get(article_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head>"
                '<meta property="og:type" content="article">'
                '<meta property="og:title" content="Maria Lopez leads Las Vegas housing drive">'
                '<meta property="og:site_name" content="Example News">'
                '<meta property="article:published_time" content="2024-05-10T12:00:00Z">'
                '<script type="application/ld+json">'
                '{"@type":"NewsArticle","headline":"Maria Lopez leads Las Vegas housing drive",'
                '"datePublished":"2024-05-10T12:00:00Z","publisher":{"name":"Example News"}}'
                "</script>"
                "</head><body>"
                "<article><h1>Maria Lopez leads Las Vegas housing drive</h1>"
                f"<p>{article_body}</p></article>"
                "</body></html>"
            ),
        )
    )
    respx.get("https://example-news.test/about").mock(
        return_value=httpx.Response(
            200,
            html="<html><body>About Example News.</body></html>",
        )
    )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "crawl",
            "--seed",
            seed_url,
            "--target-count",
            "1",
            "--max-pages",
            "5",
            "--max-depth",
            "1",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["saved"] == 1
    assert payload["fetched"] == 2
    assert payload["seeds"] == 1

    export_result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "export",
            "--format",
            "jsonl",
        ],
    )
    assert export_result.exit_code == 0, export_result.output
    article = json.loads(export_result.output)
    assert article["url"] == article_url
    assert article["published_at"] == "2024-05-10T12:00:00+00:00"
    assert article["provider"] == "crawl"
    assert article["provider_id"] == article_url
    assert article["metadata"]["discovery_method"] == "crawl"
    assert article["metadata"]["seed_url"] == "https://example-news.test"
    assert article["metadata"]["crawl_depth"] == 1
    assert article["metadata"]["body_text_length"] > 1000
    assert {mention["name"] for mention in article["metadata"]["mentions"]} >= {
        "Maria Lopez",
        "United Way Nevada",
        "Las Vegas",
        "Clark County",
    }
    assert {mention["type"] for mention in article["metadata"]["mentions"]} == {"text"}

    stats_result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "stats",
            "--json",
            "--min-count",
            "1",
            "--min-with-mentions",
            "1",
            "--min-metadata-complete",
            "1",
            "--from-date",
            "2024-05-10",
            "--to-date",
            "2024-05-10",
        ],
    )
    assert stats_result.exit_code == 0, stats_result.output
    stats = json.loads(stats_result.output)
    assert stats["metadata_complete_articles"] == 1


@respx.mock
def test_articles_crawl_fetches_independent_article_links_concurrently(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    seed_url = "https://example-news.test/"
    article_urls = [
        "https://example-news.test/2024/05/10/housing",
        "https://example-news.test/2024/05/10/transit",
        "https://example-news.test/2024/05/10/parks",
    ]
    respx.get(seed_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head><title>Example News</title></head><body>"
                + "".join(f'<a href="{article_url}">Story</a>' for article_url in article_urls)
                + "</body></html>"
            ),
        )
    )
    active_requests = 0
    max_active_requests = 0

    def delayed_article(title: str) -> Callable[[httpx.Request], object]:
        async def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal active_requests, max_active_requests
            active_requests += 1
            max_active_requests = max(max_active_requests, active_requests)
            await asyncio.sleep(0.05)
            active_requests -= 1
            body = (
                f"{title} involved Maria Lopez and United Way Nevada in Las Vegas. "
                "Clark County leaders said the civic project would support families. "
            ) * 32
            return httpx.Response(
                200,
                html=_article_html(title, body, published_at="2024-05-10T12:00:00Z"),
            )

        return handler

    for index, article_url in enumerate(article_urls, start=1):
        respx.get(article_url).mock(side_effect=delayed_article(f"Concurrent civic story {index}"))

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "crawl",
            "--seed",
            seed_url,
            "--target-count",
            "3",
            "--max-pages",
            "4",
            "--max-depth",
            "1",
            "--max-concurrent",
            "3",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["saved"] == 3
    assert max_active_requests >= 2


def test_articles_crawl_passes_timeout_to_fetcher(tmp_path: Path, monkeypatch) -> None:
    config_path = _write_config(tmp_path)
    captured: dict[str, float] = {}

    class FakeFetcher:
        def __init__(self, **kwargs: object) -> None:
            captured["timeout"] = float(kwargs["timeout"])

        async def fetch_tracked_verbose(
            self,
            _url: str,
            *,
            task_id: str,
            _store: ScoutStore,
        ) -> dict[str, object]:
            assert task_id == ""
            return {"page": None, "discovered_links": []}

        async def close(self) -> None:
            return None

    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "crawl",
            "--seed",
            "https://example-news.test/",
            "--target-count",
            "1",
            "--max-pages",
            "1",
            "--timeout-seconds",
            "7.5",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["timeout"] == 7.5


@respx.mock
def test_articles_crawl_limits_concurrent_requests_per_domain(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    first_seed_url = "https://first-news.test/"
    second_seed_url = "https://second-news.test/"
    first_article_urls = [
        "https://first-news.test/2024/05/10/housing",
        "https://first-news.test/2024/05/10/transit",
    ]
    second_article_url = "https://second-news.test/2024/05/10/parks"
    respx.get(first_seed_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head><title>First News</title></head><body>"
                + "".join(
                    f'<a href="{article_url}">Story</a>' for article_url in first_article_urls
                )
                + "</body></html>"
            ),
        )
    )
    respx.get(second_seed_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head><title>Second News</title></head><body>"
                f'<a href="{second_article_url}">Story</a>'
                "</body></html>"
            ),
        )
    )
    active_by_domain: dict[str, int] = {}
    max_active_by_domain: dict[str, int] = {}
    max_total_active = 0

    def delayed_article(title: str) -> Callable[[httpx.Request], object]:
        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal max_total_active
            domain = request.url.host or ""
            active_by_domain[domain] = active_by_domain.get(domain, 0) + 1
            max_active_by_domain[domain] = max(
                max_active_by_domain.get(domain, 0),
                active_by_domain[domain],
            )
            max_total_active = max(max_total_active, sum(active_by_domain.values()))
            await asyncio.sleep(0.05)
            active_by_domain[domain] -= 1
            body = (
                f"{title} involved Maria Lopez and United Way Nevada in Las Vegas. "
                "Clark County leaders said the civic project would support families. "
            ) * 32
            return httpx.Response(
                200,
                html=_article_html(title, body, published_at="2024-05-10T12:00:00Z"),
            )

        return handler

    for index, article_url in enumerate([*first_article_urls, second_article_url], start=1):
        respx.get(article_url).mock(side_effect=delayed_article(f"Domain limited story {index}"))

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "crawl",
            "--seed",
            first_seed_url,
            "--seed",
            second_seed_url,
            "--target-count",
            "3",
            "--max-pages",
            "5",
            "--max-depth",
            "1",
            "--max-concurrent",
            "3",
            "--max-per-domain",
            "1",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["saved"] == 3
    assert max_total_active >= 2
    assert max(max_active_by_domain.values()) == 1
