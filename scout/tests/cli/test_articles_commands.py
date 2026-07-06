"""CLI tests for Scout article corpus commands."""

from __future__ import annotations

import json
import textwrap
from typing import TYPE_CHECKING

import httpx
import respx
from click.testing import CliRunner

from atlas_scout.cli import main

if TYPE_CHECKING:
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
                            "webTitle": "Older article",
                            "webUrl": "https://www.theguardian.com/world/2006/jul/06/older",
                            "apiUrl": "https://content.guardianapis.com/world/2006/jul/06/older",
                            "fields": {"trailText": "Older context."},
                            "pillarName": "News",
                        },
                        {
                            "id": "us-news/2026/jul/05/current",
                            "type": "article",
                            "sectionName": "US news",
                            "webPublicationDate": "2026-07-05T12:00:00Z",
                            "webTitle": "Current article",
                            "webUrl": "https://www.theguardian.com/us-news/2026/jul/05/current",
                            "apiUrl": "https://content.guardianapis.com/us-news/2026/jul/05/current",
                            "fields": {"trailText": "Current context."},
                            "pillarName": "News",
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
            "--from-date",
            "2006-07-06",
            "--to-date",
            "2026-07-05",
        ],
    )
    assert stats_result.exit_code == 0, stats_result.output
    stats = json.loads(stats_result.output)
    assert stats["total_articles"] == 2
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
                            "webTitle": "Older article",
                            "webUrl": "https://www.theguardian.com/world/2006/jul/06/older",
                            "apiUrl": "https://content.guardianapis.com/world/2006/jul/06/older",
                            "fields": {"trailText": "Older context."},
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
    assert article["metadata"]["trail_text"] == "Older context."
