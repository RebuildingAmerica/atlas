"""Article crawl command implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click

from atlas_scout.article_command_support import article_crawl_seed_urls, parse_date_option
from atlas_scout.article_crawl_runner import run_article_crawl
from atlas_scout.cli_common import _run_async

if TYPE_CHECKING:
    from datetime import date

    from atlas_scout.config import ScoutConfig


@click.command("crawl")
@click.option("--seed", "seed_urls", multiple=True, help="Seed URL to crawl. Repeatable.")
@click.option(
    "--seed-file",
    type=click.File("r"),
    default=None,
    help="File with seed URLs, one per line. Use '-' for stdin.",
)
@click.option("--target-count", type=click.IntRange(1), required=True)
@click.option("--max-pages", type=click.IntRange(1), default=100, show_default=True)
@click.option("--max-depth", type=click.IntRange(0), default=1, show_default=True)
@click.option("--max-concurrent", type=click.IntRange(1), default=None)
@click.option("--max-per-domain", type=click.IntRange(1), default=2, show_default=True)
@click.option("--max-save-per-domain", type=click.IntRange(1), default=None)
@click.option(
    "--frontier-claim-size",
    type=click.IntRange(1),
    default=None,
    help="Maximum persisted frontier URLs this worker leases at a time.",
)
@click.option(
    "--frontier-lease-seconds",
    type=click.IntRange(1),
    default=900,
    show_default=True,
    help="Seconds before another worker may reclaim unfinished leased frontier URLs.",
)
@click.option(
    "--timeout-seconds",
    type=click.FloatRange(0.1),
    default=None,
    help="Per-request timeout for this crawl. Defaults to Scout's fetcher timeout.",
)
@click.option("--delay-ms", type=click.IntRange(0), default=None)
@click.option(
    "--from-date", "from_date_value", default=None, help="Only save articles on/after YYYY-MM-DD."
)
@click.option(
    "--to-date", "to_date_value", default=None, help="Only save articles on/before YYYY-MM-DD."
)
@click.option("--browser-renders", type=click.IntRange(0), default=None)
@click.option("--refresh", is_flag=True, help="Bypass cached fetch results for this crawl.")
@click.option(
    "--resume-frontier",
    is_flag=True,
    help="Start with pending URLs from Scout's persisted article frontier.",
)
@click.option(
    "--persist-frontier/--no-persist-frontier",
    default=True,
    show_default=True,
    help="Persist discovered crawl URLs so later runs can resume them.",
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def crawl(
    ctx: click.Context,
    seed_urls: tuple[str, ...],
    seed_file: click.utils.LazyFile | None,
    target_count: int,
    max_pages: int,
    max_depth: int,
    max_concurrent: int | None,
    max_per_domain: int,
    max_save_per_domain: int | None,
    frontier_claim_size: int | None,
    frontier_lease_seconds: int,
    timeout_seconds: float | None,
    delay_ms: int | None,
    from_date_value: str | None,
    to_date_value: str | None,
    browser_renders: int | None,
    refresh: bool,
    resume_frontier: bool,
    persist_frontier: bool,
    json_output: bool,
) -> None:
    """Crawl seed sites and save fetched article pages into the local corpus."""
    config: ScoutConfig = ctx.obj["config"]
    seeds = article_crawl_seed_urls(seed_urls, seed_file)
    if not seeds and not resume_frontier:
        raise click.ClickException(
            "Provide at least one --seed or --seed-file URL, or pass --resume-frontier."
        )
    from_date = _parse_optional_date(from_date_value, option_name="from-date")
    to_date = _parse_optional_date(to_date_value, option_name="to-date")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise click.ClickException("--from-date must be on or before --to-date.")
    _run_async(
        run_article_crawl(
            config,
            seed_urls=seeds,
            target_count=target_count,
            max_pages=max_pages,
            max_depth=max_depth,
            max_concurrent=max_concurrent,
            max_per_domain=max_per_domain,
            max_save_per_domain=max_save_per_domain,
            frontier_claim_size=frontier_claim_size,
            frontier_lease_seconds=frontier_lease_seconds,
            timeout_seconds=timeout_seconds,
            delay_ms=delay_ms,
            from_date=from_date,
            to_date=to_date,
            browser_renders=browser_renders,
            refresh=refresh,
            resume_frontier=resume_frontier,
            persist_frontier=persist_frontier,
            json_output=json_output,
        )
    )


def _parse_optional_date(value: str | None, *, option_name: str) -> date | None:
    """Parse an optional date option."""
    return parse_date_option(value, option_name=option_name) if value is not None else None
