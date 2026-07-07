"""CLI tests for Scout article corpus commands."""

from __future__ import annotations

import asyncio
import json
import textwrap
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.articles_commands import _extract_article_mentions
from atlas_scout.cli import main
from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


def _write_config(tmp_path: Path) -> Path:
    config_path = tmp_path / "scout.toml"
    db_path = tmp_path / "scout.db"
    config_path.write_text(
        textwrap.dedent(
            f"""\
            [store]
            path = "{db_path}"
            """
        )
    )
    return config_path


def _article_html(title: str, body_text: str, *, published_at: str) -> str:
    return (
        "<html><head>"
        '<meta property="og:type" content="article">'
        f'<meta property="og:title" content="{title}">'
        '<meta property="og:site_name" content="Example News">'
        '<script type="application/ld+json">'
        f'{{"@type":"NewsArticle","headline":"{title}",'
        f'"datePublished":"{published_at}","publisher":{{"name":"Example News"}}}}'
        "</script>"
        "</head><body>"
        f"<article><h1>{title}</h1><p>{body_text}</p></article>"
        "</body></html>"
    )


async def _seed_article_with_stale_mentions(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": "https://www.theguardian.com/us-news/2026/jul/05/current",
                    "title": "Joe Biden met Donald Trump in New York",
                    "published_at": "2026-07-05T12:00:00Z",
                    "source_name": "The Guardian",
                    "source_domain": "www.theguardian.com",
                    "section": "US news",
                    "provider": "guardian",
                    "provider_id": "us-news/2026/jul/05/current",
                    "api_url": ("https://content.guardianapis.com/us-news/2026/jul/05/current"),
                    "metadata": {
                        "trail_text": "Joe Biden spoke to CNN after the Senate vote.",
                        "body_text_excerpt": "Donald Trump responded from New York.",
                        "guardian_tags": [
                            {
                                "id": "us-news/joebiden",
                                "type": "keyword",
                                "title": "Joe Biden",
                            }
                        ],
                        "mentions": [
                            {
                                "name": "Joe Biden",
                                "type": "keyword",
                                "source": "guardian_tag",
                            }
                        ],
                    },
                }
            ]
        )
    finally:
        await store.close()


async def _seed_utility_article(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": "https://www.nydailynews.com/contact-us",
                    "title": "Contact Us",
                    "published_at": "2023-07-19T00:00:00Z",
                    "source_name": "New York Daily News",
                    "source_domain": "www.nydailynews.com",
                    "section": "contact-us",
                    "provider": "crawl",
                    "provider_id": "https://www.nydailynews.com/contact-us",
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://www.nydailynews.com/sitemap.xml",
                        "crawl_depth": 2,
                        "source_type": "news_article",
                        "publication": "New York Daily News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Contact Us CUSTOMER SERVICE " * 20,
                        "schema_types": ["WebPage", "BreadcrumbList"],
                        "opengraph_type": "article",
                        "mentions": [
                            {"name": "New York Daily News", "type": "text", "source": "body_text"}
                        ],
                    },
                }
            ]
        )
    finally:
        await store.close()


async def _seed_articles_across_date_window(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": "https://example-news.test/2001/05/01/stale-story",
                    "title": "Stale story names Civic Leader",
                    "published_at": "2001-05-01T12:00:00Z",
                    "source_name": "Example News",
                    "source_domain": "example-news.test",
                    "section": "archive",
                    "provider": "crawl",
                    "provider_id": "https://example-news.test/2001/05/01/stale-story",
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://example-news.test/sitemap.xml",
                        "crawl_depth": 2,
                        "source_type": "news_article",
                        "publication": "Example News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Civic Leader organized a neighborhood project. " * 20,
                        "schema_types": ["NewsArticle"],
                        "opengraph_type": "article",
                        "mentions": [
                            {
                                "name": "Civic Leader",
                                "type": "text",
                                "source": "body_text",
                            }
                        ],
                    },
                },
                {
                    "url": "https://example-news.test/2026/07/05/current-story",
                    "title": "Current story names Civic Partner",
                    "published_at": "2026-07-05T12:00:00Z",
                    "source_name": "Example News",
                    "source_domain": "example-news.test",
                    "section": "news",
                    "provider": "crawl",
                    "provider_id": "https://example-news.test/2026/07/05/current-story",
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://example-news.test/sitemap.xml",
                        "crawl_depth": 2,
                        "source_type": "news_article",
                        "publication": "Example News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Civic Partner organized a housing project. " * 20,
                        "schema_types": ["NewsArticle"],
                        "opengraph_type": "article",
                        "mentions": [
                            {
                                "name": "Civic Partner",
                                "type": "text",
                                "source": "body_text",
                            }
                        ],
                    },
                },
            ]
        )
    finally:
        await store.close()


async def _seed_existing_crawl_article(db_path: Path, article_url: str) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": article_url,
                    "title": "Existing article names Civic Leader",
                    "published_at": "2024-05-10T12:00:00Z",
                    "source_name": "Example News",
                    "source_domain": "example-news.test",
                    "section": "news",
                    "provider": "crawl",
                    "provider_id": article_url,
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://example-news.test/sitemap.xml",
                        "crawl_depth": 1,
                        "source_type": "news_article",
                        "publication": "Example News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Civic Leader organized a public project. " * 20,
                        "schema_types": ["NewsArticle"],
                        "opengraph_type": "article",
                        "mentions": [
                            {
                                "name": "Civic Leader",
                                "type": "text",
                                "source": "body_text",
                            }
                        ],
                    },
                }
            ]
        )
    finally:
        await store.close()


def test_extract_article_mentions_rejects_sentence_starters_and_fragments() -> None:
    mentions = _extract_article_mentions(
        title="Joe Biden met Donald Trump in New York",
        trail_text="These words are sentence starters. What changed?",
        body_text=(
            "Monday. While Joe Biden spoke to CNN, the Senate met in Washington. "
            "You're reading a sentence, not a mention."
        ),
    )

    names = {mention["name"] for mention in mentions}
    assert names >= {"Joe Biden", "Donald Trump", "New York", "CNN", "Senate", "Washington"}
    assert "These" not in names
    assert "What" not in names
    assert "Monday. While" not in names
    assert "You're" not in names


def test_extract_article_mentions_rejects_generic_single_word_artifacts() -> None:
    mentions = _extract_article_mentions(
        title="Virtual arrest order renewed",
        trail_text="Interview with Reuters after Fresh claims.",
        body_text="Anyone watching the BBC saw New York Times coverage.",
    )

    names = {mention["name"] for mention in mentions}
    assert names >= {"Reuters", "BBC", "New York Times"}
    assert "Virtual" not in names
    assert "Interview" not in names
    assert "Fresh" not in names
    assert "Anyone" not in names


def test_articles_refresh_mentions_replaces_stale_provider_tag_mentions(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    asyncio.run(_seed_article_with_stale_mentions(db_path))

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "refresh-mentions",
            "--json",
        ],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["articles"] == 1
    assert payload["updated"] == 1
    assert payload["articles_with_mentions"] == 1

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
    mentions = article["metadata"]["mentions"]
    assert {mention["name"] for mention in mentions} >= {
        "Joe Biden",
        "Donald Trump",
        "New York",
        "CNN",
        "Senate",
    }
    assert "guardian_tag" not in {mention["source"] for mention in mentions}


def test_articles_verify_rejects_utility_page_article_rows(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    asyncio.run(_seed_utility_article(db_path))

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "verify",
            "--json",
            "--min-count",
            "1",
        ],
    )

    assert result.exit_code == 1, result.output
    assert "utility-page article rows" in result.output


def test_articles_verify_can_require_every_article_inside_published_window(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    asyncio.run(_seed_articles_across_date_window(db_path))

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "verify",
            "--json",
            "--min-count",
            "2",
            "--published-from",
            "2006-07-06",
            "--published-through",
            "2026-07-06",
        ],
    )

    assert result.exit_code == 1, result.output
    assert "Article corpus includes rows before 2006-07-06" in result.output


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


@respx.mock
def test_articles_crawl_can_limit_saved_articles_per_domain(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    first_seed_url = "https://first-news.test/"
    second_seed_url = "https://second-news.test/"
    first_article_urls = [
        "https://first-news.test/2024/05/10/housing",
        "https://first-news.test/2024/05/10/transit",
        "https://first-news.test/2024/05/10/parks",
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
    for index, article_url in enumerate([*first_article_urls, second_article_url], start=1):
        article_body = (
            f"Civic Leader {index} and Community Builders opened a public project. "
            "City organizers said the civic effort would support families. "
        ) * 32
        respx.get(article_url).mock(
            return_value=httpx.Response(
                200,
                html=_article_html(
                    f"Civic Leader {index} expands local network",
                    article_body,
                    published_at="2024-05-10T12:00:00Z",
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
            "--seed",
            first_seed_url,
            "--seed",
            second_seed_url,
            "--target-count",
            "3",
            "--max-pages",
            "6",
            "--max-depth",
            "1",
            "--max-save-per-domain",
            "1",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["saved"] == 2
    assert payload["skipped_by_domain_cap"] >= 1
    assert payload["by_source_domain"] == {
        "first-news.test": 1,
        "second-news.test": 1,
    }


@respx.mock
def test_articles_crawl_skips_existing_article_urls_before_fetch(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    db_path = tmp_path / "scout.db"
    seed_url = "https://example-news.test/"
    existing_article_url = "https://example-news.test/2024/05/10/existing-story"
    new_article_url = "https://example-news.test/2024/05/10/new-story"
    asyncio.run(_seed_existing_crawl_article(db_path, existing_article_url))
    respx.get(seed_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head><title>Example News</title></head><body>"
                f'<a href="{existing_article_url}">Existing</a>'
                f'<a href="{new_article_url}">New</a>'
                "</body></html>"
            ),
        )
    )
    article_body = (
        "Nora Patel and Community Builders Dallas opened a neighborhood fund in Dallas. "
        "Civic leaders in North Texas said the project would support families. "
    ) * 32
    respx.get(new_article_url).mock(
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
            "--seed",
            seed_url,
            "--target-count",
            "1",
            "--max-pages",
            "3",
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
    assert payload["skipped_existing"] == 1
    called_urls = {str(call.request.url) for call in respx.calls}
    assert existing_article_url not in called_urls


@respx.mock
def test_articles_crawl_dedupes_tracking_query_article_variants(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    seed_url = "https://example-news.test/"
    article_url = "https://example-news.test/2024/05/10/water-lawsuit"
    tracking_url = f"{article_url}?utm_source=homepage&utm_campaign=widget"
    duplicate_tracking_url = f"{article_url}?utm_source=latest&utm_campaign=widget"
    respx.get(seed_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head><title>Example News</title></head><body>"
                f'<a href="{tracking_url}">Story</a>'
                f'<a href="{duplicate_tracking_url}">Same story</a>'
                "</body></html>"
            ),
        )
    )
    article_body = (
        "Priya Shah and Nevada Water Coalition reviewed a civic lawsuit in Las Vegas. "
        "Clark County leaders said the public process would affect residents. "
    ) * 32
    respx.get(article_url).mock(
        return_value=httpx.Response(
            200,
            html=_article_html(
                "Priya Shah reviews Las Vegas water lawsuit",
                article_body,
                published_at="2024-05-10T12:00:00Z",
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
            "--seed",
            seed_url,
            "--target-count",
            "2",
            "--max-pages",
            "3",
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
    assert payload["skipped"] == 0

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
    assert article["provider_id"] == article_url


@respx.mock
def test_articles_crawl_discovers_articles_from_sitemap_resources(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    seed_url = "https://example-news.test/sitemap.xml"
    child_sitemap_url = "https://example-news.test/sitemaps/2024.xml"
    sibling_sitemap_url = "https://example-news.test/sitemaps/2025.xml"
    article_url = "https://example-news.test/2024/05/10/civic-network"
    respx.get(seed_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text=(
                '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<sitemap><loc>{child_sitemap_url}</loc></sitemap>"
                f"<sitemap><loc>{sibling_sitemap_url}</loc></sitemap>"
                "</sitemapindex>"
            ),
        )
    )
    respx.get(child_sitemap_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text=(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<url><loc>{article_url}</loc></url>"
                "</urlset>"
            ),
        )
    )
    respx.get(sibling_sitemap_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text='<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        )
    )
    article_body = (
        "Nora Patel and Community Builders Dallas opened a neighborhood fund in Dallas. "
        "Civic leaders in North Texas said the project would support families. "
    ) * 32
    respx.get(article_url).mock(
        return_value=httpx.Response(
            200,
            html=(
                "<html><head>"
                '<meta property="og:type" content="article">'
                '<meta property="og:title" content="Nora Patel expands Dallas civic network">'
                '<meta property="og:site_name" content="Example News">'
                '<script type="application/ld+json">'
                '{"@type":"NewsArticle","headline":"Nora Patel expands Dallas civic network",'
                '"datePublished":"2024-05-10T13:30:00Z","publisher":{"name":"Example News"}}'
                "</script>"
                "</head><body>"
                "<article><h1>Nora Patel expands Dallas civic network</h1>"
                f"<p>{article_body}</p></article>"
                "</body></html>"
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
            "--seed",
            seed_url,
            "--target-count",
            "1",
            "--max-pages",
            "3",
            "--max-depth",
            "2",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["fetched"] == 3
    assert payload["saved"] == 1
    assert payload["filtered"] == 2

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
    assert article["provider"] == "crawl"
    assert article["metadata"]["seed_url"] == seed_url
    assert article["metadata"]["crawl_depth"] == 2
    assert {mention["name"] for mention in article["metadata"]["mentions"]} >= {
        "Nora Patel",
        "Community Builders Dallas",
        "Dallas",
        "North Texas",
    }

    verify_result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "verify",
            "--json",
            "--min-count",
            "1",
            "--min-unique-urls",
            "1",
            "--min-crawl",
            "1",
            "--min-crawl-discovered",
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
    assert verify_result.exit_code == 0, verify_result.output
    verification = json.loads(verify_result.output)
    assert verification["ok"] is True
    assert verification["duplicate_url_count"] == 0
    assert verification["unique_article_urls"] == 1
    assert verification["crawl_articles"] == 1
    assert verification["crawl_discovered_articles"] == 1


@respx.mock
def test_articles_crawl_prunes_discovered_urls_outside_date_window(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    seed_url = "https://example-news.test/sitemap.xml"
    old_sitemap_url = "https://example-news.test/sitemaps/2001.xml"
    current_sitemap_url = "https://example-news.test/sitemaps/2026.xml"
    stale_article_url = "https://example-news.test/2001/05/01/stale-civic-story"
    current_article_url = "https://example-news.test/2026/07/05/current-civic-story"
    respx.get(seed_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text=(
                '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<sitemap><loc>{old_sitemap_url}</loc></sitemap>"
                f"<sitemap><loc>{current_sitemap_url}</loc></sitemap>"
                "</sitemapindex>"
            ),
        )
    )
    respx.get(current_sitemap_url).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "application/xml"},
            text=(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                f"<url><loc>{stale_article_url}</loc></url>"
                f"<url><loc>{current_article_url}</loc></url>"
                "</urlset>"
            ),
        )
    )
    article_body = (
        "Nora Patel and Community Builders Dallas opened a neighborhood fund in Dallas. "
        "Civic leaders in North Texas said the project would support families. "
    ) * 32
    respx.get(current_article_url).mock(
        return_value=httpx.Response(
            200,
            html=_article_html(
                "Nora Patel expands Dallas civic network",
                article_body,
                published_at="2026-07-05T13:30:00Z",
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
            "--seed",
            seed_url,
            "--target-count",
            "1",
            "--max-pages",
            "5",
            "--max-depth",
            "2",
            "--delay-ms",
            "0",
            "--from-date",
            "2006-07-06",
            "--to-date",
            "2026-07-06",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["fetched"] == 3
    assert payload["saved"] == 1
    assert payload["pruned_by_date"] == 2
    called_urls = {str(call.request.url) for call in respx.calls}
    assert old_sitemap_url not in called_urls
    assert stale_article_url not in called_urls


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


@respx.mock
def test_articles_import_guardian_saves_source_dated_records(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    respx.get("https://content.guardianapis.com/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "response": {
                    "status": "ok",
                    "currentPage": 1,
                    "pages": 1,
                    "total": 2,
                    "results": [
                        {
                            "id": "world/2006/jul/06/older",
                            "type": "article",
                            "sectionName": "World",
                            "webPublicationDate": "2006-07-06T12:00:00Z",
                            "webTitle": "Maria Lopez leads Las Vegas housing drive",
                            "webUrl": "https://www.theguardian.com/world/2006/jul/06/older",
                            "apiUrl": "https://content.guardianapis.com/world/2006/jul/06/older",
                            "fields": {
                                "trailText": (
                                    "Maria Lopez and United Way Nevada joined Clark County leaders."
                                ),
                                "bodyText": (
                                    "Maria Lopez met United Way Nevada partners in Las Vegas."
                                ),
                            },
                            "pillarName": "News",
                            "tags": [
                                {
                                    "id": "world/example-topic",
                                    "type": "keyword",
                                    "webTitle": "Example topic",
                                },
                                {
                                    "id": "profile/reporter-one",
                                    "type": "contributor",
                                    "webTitle": "Reporter One",
                                },
                            ],
                        },
                        {
                            "id": "us-news/2026/jul/05/current",
                            "type": "article",
                            "sectionName": "US news",
                            "webPublicationDate": "2026-07-05T12:00:00Z",
                            "webTitle": "Jamal Carter expands Dallas food network",
                            "webUrl": "https://www.theguardian.com/us-news/2026/jul/05/current",
                            "apiUrl": "https://content.guardianapis.com/us-news/2026/jul/05/current",
                            "fields": {
                                "trailText": (
                                    "Jamal Carter and North Texas Food Bank opened Dallas sites."
                                ),
                                "bodyText": (
                                    "North Texas Food Bank organizers worked with Jamal Carter."
                                ),
                            },
                            "pillarName": "News",
                            "tags": [
                                {
                                    "id": "us-news/current-topic",
                                    "type": "keyword",
                                    "webTitle": "Current topic",
                                }
                            ],
                        },
                    ],
                }
            },
        )
    )

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "import",
            "guardian",
            "--api-key",
            "test-key",
            "--from-date",
            "2006-07-06",
            "--to-date",
            "2026-07-06",
            "--target-count",
            "2",
            "--page-size",
            "2",
            "--delay-ms",
            "0",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["saved"] == 2
    assert payload["fetched"] == 2
    assert payload["by_year"] == {"2006": 1, "2026": 1}

    stats_result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "stats",
            "--json",
            "--min-count",
            "2",
            "--min-with-mentions",
            "2",
            "--min-metadata-complete",
            "2",
            "--from-date",
            "2006-07-06",
            "--to-date",
            "2026-07-05",
        ],
    )
    assert stats_result.exit_code == 0, stats_result.output
    stats = json.loads(stats_result.output)
    assert stats["total_articles"] == 2
    assert stats["articles_with_mentions"] == 2
    assert stats["metadata_complete_articles"] == 2
    assert stats["total_mentions"] >= 6
    assert stats["by_mention_type"] == {"text": stats["total_mentions"]}
    assert stats["earliest_published_at"] == "2006-07-06T12:00:00Z"
    assert stats["latest_published_at"] == "2026-07-05T12:00:00Z"


@respx.mock
def test_articles_export_writes_jsonl_after_import(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    export_path = tmp_path / "articles.jsonl"
    respx.get("https://content.guardianapis.com/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "response": {
                    "status": "ok",
                    "currentPage": 1,
                    "pages": 1,
                    "total": 1,
                    "results": [
                        {
                            "id": "world/2006/jul/06/older",
                            "type": "article",
                            "sectionName": "World",
                            "webPublicationDate": "2006-07-06T12:00:00Z",
                            "webTitle": "Maria Lopez leads Las Vegas housing drive",
                            "webUrl": "https://www.theguardian.com/world/2006/jul/06/older",
                            "apiUrl": "https://content.guardianapis.com/world/2006/jul/06/older",
                            "fields": {
                                "trailText": (
                                    "Maria Lopez and United Way Nevada joined Clark County leaders."
                                ),
                                "byline": "Reporter One",
                                "shortUrl": "https://www.theguardian.com/p/example",
                                "thumbnail": "https://media.guim.co.uk/example.jpg",
                                "bodyText": (
                                    "Maria Lopez met United Way Nevada partners in Las Vegas."
                                ),
                            },
                            "tags": [
                                {
                                    "id": "world/example-topic",
                                    "type": "keyword",
                                    "webTitle": "Example topic",
                                }
                            ],
                        }
                    ],
                }
            },
        )
    )
    runner = CliRunner()
    import_result = runner.invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "import",
            "guardian",
            "--api-key",
            "test-key",
            "--from-date",
            "2006-07-06",
            "--to-date",
            "2006-07-06",
            "--target-count",
            "1",
            "--delay-ms",
            "0",
        ],
    )
    export_result = runner.invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "export",
            "--format",
            "jsonl",
            "--output",
            str(export_path),
        ],
    )

    assert import_result.exit_code == 0, import_result.output
    assert export_result.exit_code == 0, export_result.output
    lines = export_path.read_text().splitlines()
    assert len(lines) == 1
    article = json.loads(lines[0])
    assert article["url"] == "https://www.theguardian.com/world/2006/jul/06/older"
    assert article["published_at"] == "2006-07-06T12:00:00Z"
    assert article["metadata"]["trail_text"] == (
        "Maria Lopez and United Way Nevada joined Clark County leaders."
    )
    assert article["metadata"]["byline"] == "Reporter One"
    assert article["metadata"]["short_url"] == "https://www.theguardian.com/p/example"
    assert article["metadata"]["thumbnail"] == "https://media.guim.co.uk/example.jpg"
    assert article["metadata"]["body_text_length"] == 56
    assert article["metadata"]["body_text_excerpt"] == (
        "Maria Lopez met United Way Nevada partners in Las Vegas."
    )
    assert article["metadata"]["guardian_tags"] == [
        {
            "id": "world/example-topic",
            "title": "Example topic",
            "type": "keyword",
        }
    ]
    mentions = article["metadata"]["mentions"]
    assert {mention["name"] for mention in mentions} >= {
        "Maria Lopez",
        "United Way Nevada",
        "Clark County",
        "Las Vegas",
    }
    assert {mention["type"] for mention in mentions} == {"text"}
    assert "guardian_tag" not in {mention["source"] for mention in mentions}
