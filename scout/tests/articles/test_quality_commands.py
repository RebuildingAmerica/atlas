"""Article quality maintenance command tests."""

from __future__ import annotations

import asyncio
import json
import textwrap
from typing import TYPE_CHECKING

from click.testing import CliRunner

from atlas_scout.cli import main
from atlas_scout.store import ScoutStore

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


async def _seed_article_quality_rows(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                _article(
                    url="https://example-news.test/2026/07/05/strong-story",
                    title="Civic Leader opens a Las Vegas project",
                    mentions=[{"name": "Civic Leader", "type": "text", "source": "body_text"}],
                ),
                _article(
                    url="https://example-news.test/2026/07/05/weak-story",
                    title="Brief update",
                    mentions=[],
                ),
            ]
        )
    finally:
        await store.close()


def _article(url: str, title: str, mentions: list[dict[str, str]]) -> dict[str, object]:
    return {
        "url": url,
        "title": title,
        "published_at": "2026-07-05T12:00:00Z",
        "source_name": "Example News",
        "source_domain": "example-news.test",
        "section": "news",
        "provider": "crawl",
        "provider_id": url,
        "api_url": None,
        "metadata": {
            "discovery_method": "crawl",
            "seed_url": "https://example-news.test/sitemap.xml",
            "crawl_depth": 1,
            "source_type": "news_article",
            "publication": "Example News",
            "body_text_length": 1200,
            "body_text_excerpt": "Civic Leader organized a housing project. " * 20,
            "schema_types": ["NewsArticle"],
            "opengraph_type": "article",
            "mentions": mentions,
        },
    }


def test_articles_prune_quality_removes_rows_missing_mentions(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    asyncio.run(_seed_article_quality_rows(tmp_path / "scout.db"))

    dry_run = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "prune-quality",
            "--missing-mentions",
            "--json",
        ],
    )

    assert dry_run.exit_code == 0, dry_run.output
    dry_payload = json.loads(dry_run.output)
    assert dry_payload == {
        "deleted": 0,
        "dry_run": True,
        "missing_mentions": 1,
        "scanned": 2,
    }

    apply = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "prune-quality",
            "--missing-mentions",
            "--yes",
            "--json",
        ],
    )

    assert apply.exit_code == 0, apply.output
    apply_payload = json.loads(apply.output)
    assert apply_payload == {
        "deleted": 1,
        "dry_run": False,
        "missing_mentions": 1,
        "scanned": 2,
    }

    verify = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "articles",
            "verify",
            "--json",
            "--min-count",
            "1",
            "--min-with-mentions",
            "1",
            "--min-metadata-complete",
            "1",
        ],
    )
    assert verify.exit_code == 0, verify.output
