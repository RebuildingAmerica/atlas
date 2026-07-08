"""Scout article crawl link-selection CLI tests."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main

from .articles_commands_support import (
    _article_html,
    _seed_existing_crawl_article,
    _write_config,
)

if TYPE_CHECKING:
    from pathlib import Path


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
