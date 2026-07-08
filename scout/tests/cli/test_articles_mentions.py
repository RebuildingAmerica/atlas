"""Scout article mention and verification CLI tests."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from click.testing import CliRunner

from atlas_scout.articles_commands import _extract_article_mentions
from atlas_scout.cli import main

from .articles_commands_support import (
    _seed_article_with_stale_mentions,
    _seed_articles_across_date_window,
    _seed_utility_article,
    _write_config,
)

if TYPE_CHECKING:
    from pathlib import Path


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
