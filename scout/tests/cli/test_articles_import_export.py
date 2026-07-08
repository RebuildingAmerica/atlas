"""Scout article import/export CLI tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main

from .articles_commands_support import _write_config

if TYPE_CHECKING:
    from pathlib import Path


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
