"""
Atlas Scout CLI — discover people, orgs, and initiatives from the web.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import click

from atlas_scout.config import ScoutConfig, load_config

__all__ = ["main"]


@click.group()
@click.option(
    "--config",
    "config_path",
    type=click.Path(exists=False),
    default=None,
    help="Path to scout.toml config file.",
)
@click.pass_context
def main(ctx: click.Context, config_path: str | None) -> None:
    """Atlas Scout — discover people, orgs, and initiatives from the web."""
    ctx.ensure_object(dict)
    path = Path(config_path) if config_path else Path.home() / ".atlas-scout" / "scout.toml"
    ctx.obj["config"] = load_config(path)


# ---------------------------------------------------------------------------
# run command
# ---------------------------------------------------------------------------


@main.command()
@click.option("--location", required=True, help="Location in 'City, ST' format.")
@click.option("--issues", required=True, help="Comma-separated issue area slugs.")
@click.option(
    "--depth",
    type=click.Choice(["standard", "deep"]),
    default="standard",
    show_default=True,
    help="Discovery depth.",
)
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Brave Search API key (or set SEARCH_API_KEY env var).",
)
@click.pass_context
def run(
    ctx: click.Context,
    location: str,
    issues: str,
    depth: str,
    search_api_key: str | None,
) -> None:
    """Run a discovery pipeline for a location and set of issues."""
    config: ScoutConfig = ctx.obj["config"]
    issue_list = [i.strip() for i in issues.split(",") if i.strip()]

    if not search_api_key:
        click.echo("Error: SEARCH_API_KEY required", err=True)
        sys.exit(1)

    click.echo(f"Starting discovery for {location}")
    click.echo(f"Issues: {', '.join(issue_list)}")
    click.echo(f"LLM: {config.llm.provider} ({config.llm.model})")

    asyncio.run(_run_pipeline(config, location, issue_list, depth, search_api_key))


async def _run_pipeline(
    config: ScoutConfig,
    location: str,
    issues: list[str],
    depth: str,
    search_api_key: str,
) -> None:
    """Create infrastructure objects, run the pipeline, and print results."""
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    provider = _build_provider(config)

    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    store = ScoutStore(str(db_path))
    await store.initialize()

    fetcher = AsyncFetcher(
        max_concurrent=config.scraper.max_concurrent_fetches,
        request_delay_ms=config.scraper.request_delay_ms,
        page_cache_ttl_days=config.scraper.page_cache_ttl_days,
        store=store,
    )

    try:
        result = await run_pipeline(
            location=location,
            issues=issues,
            provider=provider,
            store=store,
            search_api_key=search_api_key,
            search_depth=depth,
            min_entry_score=config.pipeline.min_entry_score,
            fetcher=fetcher,
        )
    finally:
        await store.close()

    click.echo(f"\nRun ID: {result.run_id}")
    click.echo(f"Queries generated: {result.queries_generated}")
    click.echo(f"Entries found: {result.entries_found}")
    click.echo(f"Covered issues: {len(result.gap_report.covered_issues)}")
    click.echo(f"Missing issues: {len(result.gap_report.missing_issues)}")
    click.echo(f"Thin issues: {len(result.gap_report.thin_issues)}")

    if result.ranked_entries:
        click.echo(f"\nTop entries:")
        for ranked in result.ranked_entries[:10]:
            click.echo(
                f"  [{ranked.score:.2f}] {ranked.entry.name}"
                f" ({ranked.entry.entry_type}) — {ranked.entry.city}, {ranked.entry.state}"
            )


def _build_provider(config: ScoutConfig) -> object:
    """Instantiate the configured LLM provider."""
    if config.llm.provider == "anthropic":
        from atlas_scout.providers.anthropic import AnthropicProvider

        return AnthropicProvider(
            model=config.llm.model,
            max_concurrent=config.llm.max_concurrent,
        )
    # Default: ollama
    from atlas_scout.providers.ollama import OllamaProvider

    base_url = config.llm.base_url or "http://localhost:11434"
    return OllamaProvider(
        model=config.llm.model,
        base_url=base_url,
        max_concurrent=config.llm.max_concurrent,
    )


# ---------------------------------------------------------------------------
# runs sub-group
# ---------------------------------------------------------------------------


@main.group()
def runs() -> None:
    """Manage discovery runs."""


@runs.command("list")
@click.option("--limit", default=20, show_default=True, help="Maximum number of runs to show.")
@click.pass_context
def runs_list(ctx: click.Context, limit: int) -> None:
    """List recent discovery runs."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_runs_list(config, limit))


async def _runs_list(config: ScoutConfig, limit: int) -> None:
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    store = ScoutStore(str(db_path))
    await store.initialize()

    try:
        run_records = await store.list_runs(limit=limit)
    finally:
        await store.close()

    if not run_records:
        click.echo("No runs found.")
        return

    click.echo(f"{'ID':<14} {'STATUS':<12} {'LOCATION':<28} {'ENTRIES':<8} CREATED")
    click.echo("-" * 80)
    for r in run_records:
        entries = r.get("entries_found") or 0
        click.echo(
            f"{r['id']:<14} {r['status']:<12} {r['location']:<28} {entries:<8} {r['created_at'][:19]}"
        )


@runs.command("inspect")
@click.argument("run_id")
@click.pass_context
def runs_inspect(ctx: click.Context, run_id: str) -> None:
    """Show details of a specific run."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_runs_inspect(config, run_id))


async def _runs_inspect(config: ScoutConfig, run_id: str) -> None:
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    store = ScoutStore(str(db_path))
    await store.initialize()

    try:
        try:
            run_record = await store.get_run(run_id)
        except KeyError:
            click.echo(f"Run not found: {run_id}", err=True)
            sys.exit(1)

        entries = await store.list_entries(run_id=run_id)
    finally:
        await store.close()

    click.echo(f"Run: {run_record['id']}")
    click.echo(f"  Status: {run_record['status']}")
    click.echo(f"  Location: {run_record['location']}")
    click.echo(f"  Created: {run_record['created_at'][:19]}")
    if run_record.get("completed_at"):
        click.echo(f"  Completed: {run_record['completed_at'][:19]}")
    if run_record.get("error"):
        click.echo(f"  Error: {run_record['error']}")
    click.echo(f"  Queries: {run_record.get('queries') or 0}")
    click.echo(f"  Entries found: {run_record.get('entries_found') or 0}")

    if entries:
        click.echo(f"\nEntries ({len(entries)}):")
        for e in entries:
            click.echo(f"  [{e['score']:.2f}] {e['name']} ({e['entry_type']}) — {e.get('city')}, {e.get('state')}")
    else:
        click.echo("\nNo entries.")
