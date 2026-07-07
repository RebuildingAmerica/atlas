"""Article corpus stats, verification, and maintenance commands."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click

from atlas_scout.article_command_support import parse_date_option, run_async
from atlas_scout.article_stats_runtime import (
    dedupe_articles,
    prune_article_quality,
    refresh_article_mentions,
    show_article_stats,
    show_article_status,
)
from atlas_scout.article_verification import verify_articles

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


@click.command("stats")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.option("--min-count", type=click.IntRange(0), default=None)
@click.option("--min-with-mentions", type=click.IntRange(0), default=None)
@click.option("--min-metadata-complete", type=click.IntRange(0), default=None)
@click.option(
    "--from-date", "from_date_value", default=None, help="Require coverage from YYYY-MM-DD."
)
@click.option(
    "--to-date", "to_date_value", default=None, help="Require coverage through YYYY-MM-DD."
)
@click.pass_context
def stats(
    ctx: click.Context,
    json_output: bool,
    min_count: int | None,
    min_with_mentions: int | None,
    min_metadata_complete: int | None,
    from_date_value: str | None,
    to_date_value: str | None,
) -> None:
    """Show aggregate article corpus counts."""
    config: ScoutConfig = ctx.obj["config"]
    from_date = (
        parse_date_option(from_date_value, option_name="from-date")
        if from_date_value is not None
        else None
    )
    to_date = (
        parse_date_option(to_date_value, option_name="to-date")
        if to_date_value is not None
        else None
    )
    run_async(
        show_article_stats(
            config,
            json_output=json_output,
            min_count=min_count,
            min_with_mentions=min_with_mentions,
            min_metadata_complete=min_metadata_complete,
            from_date=from_date,
            to_date=to_date,
        )
    )


@click.command("status")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def status(ctx: click.Context, json_output: bool) -> None:
    """Show fast live article and frontier counts."""
    config: ScoutConfig = ctx.obj["config"]
    run_async(show_article_status(config, json_output=json_output))


@click.command("verify")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.option("--min-count", type=click.IntRange(0), default=None)
@click.option("--min-unique-urls", type=click.IntRange(0), default=None)
@click.option("--min-crawl", type=click.IntRange(0), default=None)
@click.option("--min-crawl-discovered", type=click.IntRange(0), default=None)
@click.option("--min-with-mentions", type=click.IntRange(0), default=None)
@click.option("--min-metadata-complete", type=click.IntRange(0), default=None)
@click.option(
    "--from-date", "from_date_value", default=None, help="Require coverage from YYYY-MM-DD."
)
@click.option(
    "--to-date", "to_date_value", default=None, help="Require coverage through YYYY-MM-DD."
)
@click.option(
    "--published-from",
    "published_from_value",
    default=None,
    help="Require every article to be published on/after YYYY-MM-DD.",
)
@click.option(
    "--published-through",
    "published_through_value",
    default=None,
    help="Require every article to be published on/before YYYY-MM-DD.",
)
@click.pass_context
def verify(
    ctx: click.Context,
    json_output: bool,
    min_count: int | None,
    min_unique_urls: int | None,
    min_crawl: int | None,
    min_crawl_discovered: int | None,
    min_with_mentions: int | None,
    min_metadata_complete: int | None,
    from_date_value: str | None,
    to_date_value: str | None,
    published_from_value: str | None,
    published_through_value: str | None,
) -> None:
    """Verify article corpus uniqueness, provenance, metadata, mentions, and dates."""
    config: ScoutConfig = ctx.obj["config"]
    from_date = _parse_optional_date(from_date_value, option_name="from-date")
    to_date = _parse_optional_date(to_date_value, option_name="to-date")
    published_from = _parse_optional_date(published_from_value, option_name="published-from")
    published_through = _parse_optional_date(
        published_through_value,
        option_name="published-through",
    )
    if (
        published_from is not None
        and published_through is not None
        and published_from > published_through
    ):
        raise click.ClickException("--published-from must be on or before --published-through.")
    run_async(
        verify_articles(
            config,
            json_output=json_output,
            min_count=min_count,
            min_unique_urls=min_unique_urls,
            min_crawl=min_crawl,
            min_crawl_discovered=min_crawl_discovered,
            min_with_mentions=min_with_mentions,
            min_metadata_complete=min_metadata_complete,
            from_date=from_date,
            to_date=to_date,
            published_from=published_from,
            published_through=published_through,
        )
    )


@click.command("dedupe")
@click.option("--yes", is_flag=True, help="Delete duplicate rows instead of dry-running.")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def dedupe(ctx: click.Context, yes: bool, json_output: bool) -> None:
    """Remove duplicate article rows with the same title and publication timestamp."""
    config: ScoutConfig = ctx.obj["config"]
    run_async(dedupe_articles(config, dry_run=not yes, json_output=json_output))


@click.command("prune-quality")
@click.option("--missing-mentions", is_flag=True, help="Delete rows without extracted mentions.")
@click.option("--yes", is_flag=True, help="Delete matching rows instead of dry-running.")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def prune_quality(
    ctx: click.Context,
    missing_mentions: bool,
    yes: bool,
    json_output: bool,
) -> None:
    """Prune article rows that fail selected quality gates."""
    config: ScoutConfig = ctx.obj["config"]
    run_async(
        prune_article_quality(
            config,
            dry_run=not yes,
            missing_mentions=missing_mentions,
            json_output=json_output,
        )
    )


@click.command("refresh-mentions")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def refresh_mentions(ctx: click.Context, json_output: bool) -> None:
    """Recompute stored article mention candidates from local article text fields."""
    config: ScoutConfig = ctx.obj["config"]
    run_async(refresh_article_mentions(config, json_output=json_output))


def _parse_optional_date(value: str | None, *, option_name: str) -> date | None:
    """Parse an optional date option."""
    return parse_date_option(value, option_name=option_name) if value is not None else None
