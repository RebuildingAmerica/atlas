"""Article corpus command group for Atlas Scout."""

from __future__ import annotations

import click

from atlas_scout.articles.crawl_commands import crawl
from atlas_scout.articles.export_commands import export
from atlas_scout.articles.frontier_commands import frontier
from atlas_scout.articles.import_commands import import_group
from atlas_scout.articles.mentions import extract_article_mentions as _extract_article_mentions
from atlas_scout.articles.stats_commands import (
    dedupe,
    prune_quality,
    refresh_mentions,
    stats,
    status,
    verify,
)

__all__ = ["_extract_article_mentions", "articles"]


@click.group()
def articles() -> None:
    """Collect and export local news article corpora."""


ARTICLE_COMMANDS: tuple[click.Command, ...] = (
    crawl,
    dedupe,
    export,
    frontier,
    import_group,
    prune_quality,
    refresh_mentions,
    stats,
    status,
    verify,
)

for article_command in ARTICLE_COMMANDS:
    articles.add_command(article_command)
