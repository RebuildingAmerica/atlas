"""Article frontier command implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click

from atlas_scout.articles.command_support import article_crawl_seed_urls, parse_date_option
from atlas_scout.articles.frontier_expand import expand_frontier
from atlas_scout.articles.frontier_runtime import (
    release_frontier_claims,
    reprioritize_frontier,
    seed_frontier,
    show_frontier_stats,
)
from atlas_scout.cli_common import _run_async

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


@click.group("frontier")
def frontier() -> None:
    """Inspect and repair the persisted article crawl frontier."""


@frontier.command("stats")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def stats(ctx: click.Context, json_output: bool) -> None:
    """Show pending, fetched, and skipped article frontier counts."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(show_frontier_stats(config, json_output=json_output))


@frontier.command("release-claims")
@click.option(
    "--worker-id", required=True, help="Article crawl worker id whose claims should be released."
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def release_claims(ctx: click.Context, worker_id: str, json_output: bool) -> None:
    """Release unfinished article frontier claims for a stopped worker."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        release_frontier_claims(
            config,
            worker_id=worker_id,
            json_output=json_output,
        )
    )


@frontier.command("reprioritize")
@click.option("--limit", type=click.IntRange(0), default=0, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def reprioritize(
    ctx: click.Context,
    limit: int,
    json_output: bool,
) -> None:
    """Re-score pending frontier URLs so resume crawls fetch likely articles first."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        reprioritize_frontier(
            config,
            limit=limit,
            json_output=json_output,
        )
    )


@frontier.command("expand")
@click.option("--limit", type=click.IntRange(1), default=1000, show_default=True)
@click.option("--max-concurrent", type=click.IntRange(1), default=None)
@click.option("--max-per-domain", type=click.IntRange(1), default=10, show_default=True)
@click.option(
    "--timeout-seconds",
    type=click.FloatRange(0.1),
    default=None,
    help="Per-request timeout for this expansion. Defaults to Scout's fetcher timeout.",
)
@click.option("--delay-ms", type=click.IntRange(0), default=None)
@click.option(
    "--from-date",
    "from_date_value",
    default=None,
    help="Only enqueue articles on/after YYYY-MM-DD.",
)
@click.option(
    "--to-date", "to_date_value", default=None, help="Only enqueue articles on/before YYYY-MM-DD."
)
@click.option("--browser-renders", type=click.IntRange(0), default=None)
@click.option("--refresh", is_flag=True, help="Bypass cached fetch results for this expansion.")
@click.option(
    "--save-articles",
    is_flag=True,
    help="Save article records when sitemap/feed metadata includes URL, title, and date.",
)
@click.option(
    "--include-fetched",
    is_flag=True,
    help="Reprocess fetched sitemap/feed frontier rows, usually with --refresh.",
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def expand(
    ctx: click.Context,
    limit: int,
    max_concurrent: int | None,
    max_per_domain: int,
    timeout_seconds: float | None,
    delay_ms: int | None,
    from_date_value: str | None,
    to_date_value: str | None,
    browser_renders: int | None,
    refresh: bool,
    save_articles: bool,
    include_fetched: bool,
    json_output: bool,
) -> None:
    """Fetch discovery frontier URLs and enqueue their linked article work."""
    config: ScoutConfig = ctx.obj["config"]
    from_date = _parse_optional_date(from_date_value, option_name="from-date")
    to_date = _parse_optional_date(to_date_value, option_name="to-date")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise click.ClickException("--from-date must be on or before --to-date.")
    _run_async(
        expand_frontier(
            config,
            limit=limit,
            max_concurrent=max_concurrent,
            max_per_domain=max_per_domain,
            timeout_seconds=timeout_seconds,
            delay_ms=delay_ms,
            from_date=from_date,
            to_date=to_date,
            browser_renders=browser_renders,
            refresh=refresh,
            save_articles=save_articles,
            include_fetched=include_fetched,
            json_output=json_output,
        )
    )


@frontier.command("seed")
@click.option("--seed", "seed_urls", multiple=True, help="Source seed URL to persist.")
@click.option(
    "--seed-file",
    type=click.File("r"),
    default=None,
    help="File with source seed URLs, one per line. Use '-' for stdin.",
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def seed(
    ctx: click.Context,
    seed_urls: tuple[str, ...],
    seed_file: click.utils.LazyFile | None,
    json_output: bool,
) -> None:
    """Persist source seeds into the article frontier for resumable crawls."""
    config: ScoutConfig = ctx.obj["config"]
    seeds = article_crawl_seed_urls(seed_urls, seed_file)
    if not seeds:
        raise click.ClickException("Provide at least one --seed or --seed-file URL.")
    _run_async(seed_frontier(config, seed_urls=seeds, json_output=json_output))


def _parse_optional_date(value: str | None, *, option_name: str) -> date | None:
    """Parse an optional date option."""
    return parse_date_option(value, option_name=option_name) if value is not None else None
