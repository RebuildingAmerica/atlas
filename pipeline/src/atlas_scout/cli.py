"""Atlas Scout CLI — discover people, orgs, and initiatives from the web."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from atlas_scout.cli_output import (
    print_duplicate_run_notice,
    print_run_banner,
    print_run_results,
    styled_status,
)
from atlas_scout.cli_progress import ProgressRenderer
from atlas_scout.config import (
    SCOUT_CONFIGS_DIR,
    ScoutConfig,
    get_active_config_path,
    get_active_profile_name,
    load_config,
    set_active_profile_name,
)
from atlas_scout.runtime import build_runtime_profile

__all__ = ["main"]

console = Console()
err_console = Console(stderr=True)


def _runtime_profile_for_run(config: ScoutConfig, *, direct_mode: bool):
    """Build a runtime profile for the current run mode."""
    try:
        return build_runtime_profile(config, direct_mode=direct_mode)
    except TypeError:
        return build_runtime_profile(config)


# ---------------------------------------------------------------------------
# Root group
# ---------------------------------------------------------------------------


@click.group()
@click.option("--config", "config_path", type=click.Path(exists=False), default=None,
              help="Full path to a config file. Overrides --profile.")
@click.option("--profile", "profile_name", default=None,
              help="Config profile name to load from the configs directory (e.g. 'studio', 'laptop').")
@click.option("--debug", is_flag=True, help="Verbose debug logging to stderr.")
@click.pass_context
def main(ctx: click.Context, config_path: str | None, profile_name: str | None, debug: bool) -> None:
    """Atlas Scout — discover people, orgs, and initiatives from the web."""
    ctx.ensure_object(dict)
    if config_path:
        path = Path(config_path)
    elif profile_name:
        path = SCOUT_CONFIGS_DIR / f"{profile_name}.toml"
        if not path.exists():
            available = sorted(p.stem for p in SCOUT_CONFIGS_DIR.glob("*.toml"))
            err_console.print(f"[red]Error:[/] profile '{profile_name}' not found at {path}")
            if available:
                err_console.print(f"Available profiles: {', '.join(available)}")
            ctx.exit(1)
    else:
        path = get_active_config_path()
    ctx.obj["config"] = load_config(path)
    ctx.obj["config_path"] = path
    ctx.obj["debug"] = debug

    if debug:
        logging.basicConfig(level=logging.DEBUG,
                            format="%(asctime)s %(name)s %(levelname)s: %(message)s",
                            stream=sys.stderr)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("httpx").setLevel(logging.WARNING)
    else:
        logging.basicConfig(level=logging.WARNING, stream=sys.stderr)


# ---------------------------------------------------------------------------
# run command
# ---------------------------------------------------------------------------


@main.command()
@click.argument("urls", nargs=-1)
@click.option("--file", "-f", "url_file", type=click.File("r"), default=None,
              help="File with URLs (one per line). Use '-' for stdin.")
@click.option("--prompt", "prompt_text", default=None,
              help="Natural language directive to focus extraction.")
@click.option("--prompt-file", type=click.File("r"), default=None,
              help="File containing extraction directive.")
@click.option("--provider", default=None, help="LLM provider override (ollama, anthropic).")
@click.option("--model", "model_name", default=None, help="Model name override.")
@click.option("--location", default=None, help="Location hint (e.g. 'Austin, TX').")
@click.option("--issues", default=None, help="Comma-separated issue area slugs.")
@click.option("--depth", type=click.Choice(["standard", "deep"]), default="standard",
              show_default=True, help="Discovery depth (search mode).")
@click.option("--search-api-key", envvar="SEARCH_API_KEY", default=None,
              help="Brave Search API key. Enables search mode.")
@click.option("--follow-links/--no-follow-links", default=None,
              help="Follow same-domain links discovered during fetches.")
@click.option("--max-link-depth", type=int, default=None,
              help="Maximum crawl depth when following discovered links.")
@click.option("--max-pages-per-seed", type=int, default=None,
              help="Maximum total pages to queue from each seed URL.")
@click.option("--refresh", is_flag=True,
              help="Bypass cached fetch and extraction results for this run.")
@click.option("--verbose-progress", is_flag=True,
              help="Show internal worker and queue events instead of the default user-facing firehose.")
@click.option("--quiet", "-q", is_flag=True, help="Headless mode — suppress progress.")
@click.pass_context
def run(
    ctx: click.Context,
    urls: tuple[str, ...],
    url_file: click.utils.LazyFile | None,
    prompt_text: str | None,
    prompt_file: click.utils.LazyFile | None,
    provider: str | None,
    model_name: str | None,
    location: str | None,
    issues: str | None,
    depth: str,
    search_api_key: str | None,
    follow_links: bool | None,
    max_link_depth: int | None,
    max_pages_per_seed: int | None,
    refresh: bool,
    verbose_progress: bool,
    quiet: bool,
) -> None:
    """Run a discovery pipeline.

    \b
    Scrape URLs directly:
        scout run https://example.com/article
        scout run -f urls.txt
    \b
    Focus the extraction:
        scout run --prompt "Find free legal aid orgs" https://example.com
    \b
    Search mode:
        scout run --location "Austin, TX" --issues housing_affordability --search-api-key KEY
    """
    config: ScoutConfig = ctx.obj["config"]

    if provider:
        config.llm.provider = provider
    if model_name:
        config.llm.model = model_name

    # Merge URLs from positional args + file
    url_list: list[str] = list(urls) if urls else []
    if url_file:
        for line in url_file:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                url_list.append(stripped)

    # Resolve extraction directive
    directive: str | None = prompt_text
    if prompt_file and not directive:
        directive = prompt_file.read().strip()

    issue_list = [i.strip() for i in issues.split(",") if i.strip()] if issues else []

    if follow_links is not None:
        config.scraper.follow_links = follow_links
    if max_link_depth is not None:
        config.scraper.max_link_depth = max_link_depth
    if max_pages_per_seed is not None:
        config.scraper.max_pages_per_seed = max_pages_per_seed

    # Validation
    if not url_list:
        if not search_api_key:
            err_console.print(
                "[bold]Usage:[/]\n"
                "  scout run <url> [<url> ...]\n"
                "  scout run -f urls.txt\n"
                "  scout run --location 'City, ST' --issues <slugs> --search-api-key KEY"
            )
            sys.exit(1)
        if not location:
            err_console.print("[red]Error:[/] --location required for search mode.")
            sys.exit(1)
        if not issue_list:
            err_console.print("[red]Error:[/] --issues required for search mode.")
            sys.exit(1)

    if not quiet:
        profile = _runtime_profile_for_run(config, direct_mode=bool(url_list))
        print_run_banner(
            console,
            config=config,
            profile=profile,
            refresh=refresh,
            directive=directive,
            location=location,
            url_count=len(url_list),
        )

    asyncio.run(
        _run_pipeline(
            config=config,
            location=location or "",
            issues=issue_list,
            depth=depth,
            search_api_key=search_api_key,
            direct_urls=url_list or None,
            quiet=quiet,
            directive=directive,
            refresh=refresh,
            verbose_progress=verbose_progress,
        )
    )


async def _run_pipeline(
    config: ScoutConfig,
    location: str,
    issues: list[str],
    depth: str,
    search_api_key: str | None,
    direct_urls: list[str] | None = None,
    quiet: bool = False,
    directive: str | None = None,
    refresh: bool = False,
    verbose_progress: bool = False,
) -> None:
    """Create infrastructure, run the pipeline, print results."""
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    store = ScoutStore(str(db_path))
    await store.initialize()

    normalized_direct_urls = [url.strip().rstrip("/") for url in (direct_urls or []) if url.strip()]
    if normalized_direct_urls and not refresh:
        existing_run_id = await store.find_running_direct_run(normalized_direct_urls)
        if existing_run_id is not None:
            print_duplicate_run_notice(console, existing_run_id)
            await store.close()
            return

    profile = _runtime_profile_for_run(config, direct_mode=bool(direct_urls))
    provider = _build_provider(config, max_concurrent=profile.extract_concurrency)

    fetcher_kwargs: dict = {
        "max_concurrent": profile.fetch_concurrency,
        "request_delay_ms": config.scraper.request_delay_ms,
        "page_cache_ttl_days": config.scraper.page_cache_ttl_days,
        "revisit_cached_urls": config.scraper.revisit_cached_urls,
        "store": store,
        "run_id": "pending",
        "force_refresh": refresh,
    }
    fetcher = AsyncFetcher(**fetcher_kwargs)
    progress = ProgressRenderer(console=console, quiet=quiet, verbose=verbose_progress)

    try:
        result = await run_pipeline(
            location=location,
            issues=issues,
            provider=provider,
            store=store,
            search_api_key=search_api_key or "",
            search_depth=depth,
            min_entry_score=config.pipeline.min_entry_score,
            reuse_cached_extractions=config.pipeline.reuse_cached_extractions and not refresh,
            fetcher=fetcher,
            direct_urls=direct_urls,
            on_progress=progress.emit,
            extraction_directive=directive,
            search_concurrency=profile.search_concurrency,
            follow_links=config.scraper.follow_links,
            max_link_depth=config.scraper.max_link_depth,
            max_pages_per_seed=config.scraper.max_pages_per_seed,
            iterative_deepening=config.pipeline.iterative_deepening,
            contribution_config=config.contribution,
        )
    finally:
        await _close_if_supported(fetcher)
        await _close_if_supported(provider)
        await store.close()

    print_run_results(console, result)


def _build_provider(config: ScoutConfig, *, max_concurrent: int | None = None) -> object:
    """Instantiate the configured LLM provider."""
    from atlas_scout.providers import create_provider

    return create_provider(config.llm, max_concurrent=max_concurrent)


from atlas_scout.pipeline_support import close_if_supported as _close_if_supported  # noqa: E402


# ---------------------------------------------------------------------------
# db commands
# ---------------------------------------------------------------------------


@main.group()
def db() -> None:
    """Manage the local Scout database."""


@db.command("reset")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation.")
@click.pass_context
def db_reset(ctx: click.Context, yes: bool) -> None:
    """Delete all local data (runs, entries, pages)."""
    config: ScoutConfig = ctx.obj["config"]
    db_path = Path(config.store.path).expanduser()
    if not yes and not click.confirm("Delete all Scout data?"):
        console.print("[dim]Cancelled.[/]")
        return
    if db_path.exists():
        db_path.unlink()
        console.print(f"  [red]Deleted[/] {db_path}")
    console.print("[green]Database reset.[/]")


@db.command("path")
@click.pass_context
def db_path_cmd(ctx: click.Context) -> None:
    """Print the database file path."""
    config: ScoutConfig = ctx.obj["config"]
    console.print(Path(config.store.path).expanduser())


# ---------------------------------------------------------------------------
# config commands
# ---------------------------------------------------------------------------


@main.group("config")
def config_group() -> None:
    """View and update Scout configuration."""


@config_group.command("profiles")
def config_profiles() -> None:
    """List available configuration profiles."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    profiles = sorted(SCOUT_CONFIGS_DIR.glob("*.toml"))
    if not profiles:
        console.print(f"No profiles found in {SCOUT_CONFIGS_DIR}")
        return
    active = get_active_profile_name()
    for p in profiles:
        marker = " [green](active)[/]" if p.stem == active else ""
        console.print(f"  {p.stem}{marker}")
    console.print("\n[dim]Use 'scout config use-profile <name>' to set the active profile.[/]")


@config_group.command("use-profile")
@click.argument("name")
def config_use_profile(name: str) -> None:
    """Set a profile as the active default (e.g. scout config use-profile studio)."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    source = SCOUT_CONFIGS_DIR / f"{name}.toml"
    if not source.exists():
        available = sorted(p.stem for p in SCOUT_CONFIGS_DIR.glob("*.toml"))
        err_console.print(f"[red]Error:[/] profile '{name}' not found.")
        if available:
            err_console.print(f"Available profiles: {', '.join(available)}")
        sys.exit(1)
    set_active_profile_name(name)
    console.print(f"[green]Active profile set to '{name}'.[/]")


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    """Print the current configuration."""
    config: ScoutConfig = ctx.obj["config"]
    table = Table(title="Scout Configuration", show_lines=False, pad_edge=False)
    table.add_column("Setting", style="bold")
    table.add_column("Value")
    table.add_row("llm.provider", config.llm.provider)
    table.add_row("llm.model", config.llm.model)
    table.add_row("llm.base_url", config.llm.base_url or "[dim]default[/]")
    table.add_row("llm.api_key", "[dim]***[/]" if config.llm.api_key else "[dim]not set[/]")
    table.add_row("llm.max_concurrent", str(config.llm.max_concurrent))
    table.add_row("scraper.max_concurrent_fetches", str(config.scraper.max_concurrent_fetches))
    table.add_row("scraper.request_delay_ms", str(config.scraper.request_delay_ms))
    table.add_row("pipeline.min_entry_score", str(config.pipeline.min_entry_score))
    table.add_row("store.path", config.store.path)
    console.print(table)
    loaded_path: Path = ctx.obj["config_path"]
    console.print(f"\n[dim]Profile: {loaded_path.stem} ({loaded_path})[/]")


@config_group.command("set")
@click.argument("key")
@click.argument("value")
def config_set(key: str, value: str) -> None:
    """Set a configuration value persistently (e.g. scout config set llm.model gemma3n:latest)."""
    import tomllib
    config_path = get_active_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict = {}
    if config_path.exists():
        with config_path.open("rb") as f:
            data = tomllib.load(f)
    parts = key.split(".")
    if len(parts) != 2:
        err_console.print("[red]Error:[/] key must be section.field (e.g. llm.provider)")
        sys.exit(1)
    section, field = parts
    # Coerce types
    typed: str | int | float | bool
    if value.lower() in ("true", "false"):
        typed = value.lower() == "true"
    else:
        try:
            typed = int(value)
        except ValueError:
            try:
                typed = float(value)
            except ValueError:
                typed = value
    data.setdefault(section, {})[field] = typed
    _write_toml(config_path, data)
    console.print(f"[green]Set[/] {key} = [bold]{value}[/]")


@config_group.command("get")
@click.argument("key")
@click.pass_context
def config_get(ctx: click.Context, key: str) -> None:
    """Get a single configuration value."""
    config: ScoutConfig = ctx.obj["config"]
    parts = key.split(".")
    if len(parts) != 2:
        err_console.print("[red]Error:[/] key must be section.field")
        sys.exit(1)
    section_obj = getattr(config, parts[0], None)
    if section_obj is None:
        err_console.print(f"[red]Unknown section:[/] {parts[0]}")
        sys.exit(1)
    val = getattr(section_obj, parts[1], None)
    if parts[1] == "api_key" and val:
        console.print("[dim]***[/]")
    else:
        console.print(str(val) if val is not None else "[dim]not set[/]")


def _write_toml(path: Path, data: dict) -> None:
    """Write a flat dict-of-dicts as TOML."""
    lines: list[str] = []
    for section, values in data.items():
        if not isinstance(values, dict):
            continue
        lines.append(f"[{section}]")
        for k, v in values.items():
            if isinstance(v, bool):
                lines.append(f"{k} = {str(v).lower()}")
            elif isinstance(v, str):
                lines.append(f'{k} = "{v}"')
            else:
                lines.append(f"{k} = {v}")
        lines.append("")
    path.write_text("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# runs commands
# ---------------------------------------------------------------------------


@main.group()
def runs() -> None:
    """Manage discovery runs."""


@runs.command("list")
@click.option("--limit", default=20, show_default=True)
@click.pass_context
def runs_list(ctx: click.Context, limit: int) -> None:
    """List recent discovery runs."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_runs_list(config, limit))


async def _runs_list(config: ScoutConfig, limit: int) -> None:
    """Fetch and print recent runs."""
    from atlas_scout.store import ScoutStore
    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        records = await store.list_runs(limit=limit)
    finally:
        await store.close()
    if not records:
        console.print("[dim]No runs found.[/]")
        return
    table = Table(show_lines=False, pad_edge=False)
    table.add_column("ID", style="bold")
    table.add_column("Status")
    table.add_column("Location")
    table.add_column("Entries", justify="right")
    table.add_column("Created", style="dim")
    for r in records:
        table.add_row(r["id"], styled_status(r["status"]), r["location"] or "—",
                       str(r.get("entries_found") or 0), r["created_at"][:19])
    console.print(table)


@runs.command("inspect")
@click.argument("run_id")
@click.pass_context
def runs_inspect(ctx: click.Context, run_id: str) -> None:
    """Show details of a specific run."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_runs_inspect(config, run_id))


async def _runs_inspect(config: ScoutConfig, run_id: str) -> None:
    """Print detailed run information."""
    from atlas_scout.store import ScoutStore
    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            rec = await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)
        entries = await store.list_entries(run_id=run_id)
        page_tasks = await store.list_page_tasks(run_id) if hasattr(store, "list_page_tasks") else []
    finally:
        await store.close()

    console.print(f"[bold]Run {rec['id']}[/]")
    console.print(f"  Status: {styled_status(rec['status'])}")
    if rec["location"]:
        console.print(f"  Location: {rec['location']}")
    console.print(f"  Created: [dim]{rec['created_at'][:19]}[/]")
    if rec.get("completed_at"):
        console.print(f"  Completed: [dim]{rec['completed_at'][:19]}[/]")
    if rec.get("error"):
        console.print(f"  Error: [red]{rec['error']}[/]")

    if page_tasks:
        console.print()
        pt_table = Table(title=f"Pages ({len(page_tasks)})", show_lines=False, pad_edge=False)
        pt_table.add_column("Status")
        pt_table.add_column("Detail")
        pt_table.add_column("URL", style="dim")
        for pt in page_tasks:
            detail = ""
            if pt.get("entries_extracted"):
                detail = f"{pt['entries_extracted']} entries"
            elif pt.get("error"):
                detail = pt["error"]
            pt_table.add_row(styled_status(pt["status"]), detail, pt["url"])
        console.print(pt_table)

    if entries:
        console.print()
        for e in entries:
            console.print(f"  [{e['score']:.2f}] {e['name']} ({e['entry_type']}) — {e.get('city')}, {e.get('state')}")
    else:
        console.print("\n[dim]No entries.[/]")


# ---------------------------------------------------------------------------
# entries commands
# ---------------------------------------------------------------------------


@main.group()
def entries() -> None:
    """Browse discovered entries."""


@entries.command("list")
@click.option("--min-score", default=0.0, type=float)
@click.option("--type", "entry_type", default=None)
@click.option("--limit", default=50, show_default=True)
@click.option("--format", "-o", "output_format",
              type=click.Choice(["table", "json", "csv"]), default="table")
@click.pass_context
def entries_list(ctx: click.Context, min_score: float, entry_type: str | None,
                 limit: int, output_format: str) -> None:
    """List all discovered entries."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_entries_list(config, min_score, entry_type, limit, output_format))


async def _entries_list(config: ScoutConfig, min_score: float, entry_type: str | None,
                        limit: int, output_format: str) -> None:
    """Fetch and display entries in the requested format."""
    from atlas_scout.store import ScoutStore
    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        console.print("[dim]No entries yet. Run 'scout run' first.[/]")
        return
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        all_entries = await store.list_entries(min_score=min_score)
    finally:
        await store.close()
    if entry_type:
        all_entries = [e for e in all_entries if e["entry_type"] == entry_type]
    shown = all_entries[:limit]
    if not shown:
        if output_format == "json":
            click.echo("[]")
        elif output_format != "csv":
            console.print("[dim]No entries found.[/]")
        return

    if output_format == "json":
        rows = [{
            "name": e["name"], "entry_type": e["entry_type"],
            "description": e.get("description", ""),
            "city": e.get("city"), "state": e.get("state"),
            "score": e["score"],
            "website": e.get("data", {}).get("website"),
            "email": e.get("data", {}).get("email"),
            "issue_areas": e.get("data", {}).get("issue_areas", []),
            "source_urls": e.get("data", {}).get("source_urls", []),
        } for e in shown]
        click.echo(json.dumps(rows, indent=2))
        return

    if output_format == "csv":
        fields = ["name", "entry_type", "description", "city", "state",
                   "score", "website", "email", "issue_areas"]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields)
        writer.writeheader()
        for e in shown:
            data = e.get("data", {})
            writer.writerow({
                "name": e["name"], "entry_type": e["entry_type"],
                "description": e.get("description", ""),
                "city": e.get("city") or "", "state": e.get("state") or "",
                "score": f"{e['score']:.2f}",
                "website": data.get("website") or "",
                "email": data.get("email") or "",
                "issue_areas": ";".join(data.get("issue_areas", [])),
            })
        click.echo(buf.getvalue(), nl=False)
        return

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Score", style="bold", width=6, justify="right")
    table.add_column("Type", style="dim")
    table.add_column("Name")
    table.add_column("Location")
    for e in shown:
        table.add_row(f"{e['score']:.2f}", e["entry_type"], e["name"],
                       f"{e.get('city') or '?'}, {e.get('state') or '?'}")
    console.print(table)
    if len(all_entries) > limit:
        console.print(f"\n[dim]... and {len(all_entries) - limit} more (--limit to show more)[/]")


# ---------------------------------------------------------------------------
# pages commands
# ---------------------------------------------------------------------------


@main.group()
def pages() -> None:
    """Browse scraped pages."""


@pages.command("list")
@click.option("--limit", default=50, show_default=True)
@click.pass_context
def pages_list(ctx: click.Context, limit: int) -> None:
    """List all scraped pages with status."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_pages_list(config, limit))


async def _pages_list(config: ScoutConfig, limit: int) -> None:
    """Fetch and print page tracking data."""
    from atlas_scout.store import ScoutStore
    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        console.print("[dim]No pages yet.[/]")
        return
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        if hasattr(store, "list_all_page_tasks"):
            tasks = await store.list_all_page_tasks(limit=limit)
        else:
            tasks = []
        if not tasks:
            cached = await store.list_pages(limit=limit)
            if not cached:
                console.print("[dim]No pages yet.[/]")
                return
            table = Table(show_lines=False, pad_edge=False)
            table.add_column("Fetched", style="dim")
            table.add_column("Title")
            table.add_column("URL", style="dim")
            for p in cached:
                title = (p["metadata"].get("title") or "—")[:38]
                table.add_row(p["fetched_at"][:19], title, p["url"])
            console.print(table)
            return
    finally:
        await store.close()

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Status")
    table.add_column("Detail")
    table.add_column("URL", style="dim")
    for t in tasks:
        detail = ""
        if t["entries_extracted"]:
            detail = f"{t['entries_extracted']} entries"
        elif t.get("error"):
            detail = t["error"]
        table.add_row(styled_status(t["status"]), detail, t["url"])
    console.print(table)


# ---------------------------------------------------------------------------
# schedule — Run discovery on configured schedule targets
# ---------------------------------------------------------------------------


@main.group()
def schedule() -> None:
    """Manage scheduled discovery runs."""


@schedule.command("run-once")
@click.option("--search-api-key", envvar="SEARCH_API_KEY", required=True)
@click.pass_context
def schedule_run_once(ctx: click.Context, search_api_key: str) -> None:
    """Run all configured schedule targets once."""
    config: ScoutConfig = ctx.obj["config"]
    if not config.schedule.targets:
        console.print("[yellow]No schedule targets configured.[/]")
        console.print("Add targets to your config under [schedule.targets].")
        return
    console.print(f"[bold]Running {len(config.schedule.targets)} targets...[/]")
    run_ids = asyncio.run(
        _schedule_run_once(config, search_api_key)
    )
    console.print(f"\n[bold green]Completed {len(run_ids)} runs.[/]")
    for rid in run_ids:
        console.print(f"  {rid}")


async def _schedule_run_once(config: ScoutConfig, search_api_key: str) -> list[str]:
    from atlas_scout.scheduler import run_schedule_once

    return await run_schedule_once(config, search_api_key)


@schedule.command("start")
@click.option("--search-api-key", envvar="SEARCH_API_KEY", required=True)
@click.option("--interval", default=0, help="Override interval in seconds (0 = use cron from config)")
@click.pass_context
def schedule_start(ctx: click.Context, search_api_key: str, interval: int) -> None:
    """Start the scheduler loop (runs until interrupted)."""
    config: ScoutConfig = ctx.obj["config"]
    if not config.schedule.targets:
        console.print("[yellow]No schedule targets configured.[/]")
        return
    console.print(f"[bold]Starting scheduler with {len(config.schedule.targets)} targets...[/]")
    console.print("Press Ctrl+C to stop.\n")
    try:
        asyncio.run(
            _schedule_start(config, search_api_key, interval)
        )
    except KeyboardInterrupt:
        console.print("\n[bold]Scheduler stopped.[/]")


async def _schedule_start(config: ScoutConfig, search_api_key: str, interval: int) -> None:
    from atlas_scout.scheduler import run_schedule_loop

    await run_schedule_loop(config, search_api_key, interval_seconds=interval)
