"""Scout article crawl domain-cap CLI tests."""

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
