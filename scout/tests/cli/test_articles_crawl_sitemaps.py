"""Scout article crawl sitemap CLI tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main

from .articles_commands_support import _article_html, _write_config

if TYPE_CHECKING:
    from pathlib import Path


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
