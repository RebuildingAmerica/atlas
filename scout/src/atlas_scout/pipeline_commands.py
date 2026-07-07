"""Pipeline execution command for Scout."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import click

from atlas_scout.auth_commands import _resolve_search_connection
from atlas_scout.cli_common import _exit_with_error, _run_async
from atlas_scout.cli_context import console
from atlas_scout.cli_errors import CliError
from atlas_scout.cli_progress import ProgressRenderer
from atlas_scout.local_model_commands import (
    _prepare_local_model_config,
    _print_local_model_resolution,
)
from atlas_scout.pipeline_support import close_if_supported as _close_if_supported
from atlas_scout.pipeline_support import normalize_url
from atlas_scout.run_report import print_duplicate_run_notice, print_run_banner, print_run_results
from atlas_scout.runs_commands import _runs_sync, _should_sync_after_run
from atlas_scout.runtime import build_runtime_profile

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.runtime import RuntimeProfile


def _runtime_profile_for_run(config: ScoutConfig, *, direct_mode: bool) -> RuntimeProfile:
    """Build a runtime profile for the current run mode."""
    try:
        return build_runtime_profile(config, direct_mode=direct_mode)
    except TypeError:
        return build_runtime_profile(config)


# ---------------------------------------------------------------------------
# run command
# ---------------------------------------------------------------------------


@click.command()
@click.argument("urls", nargs=-1)
@click.option(
    "--file",
    "-f",
    "url_file",
    type=click.File("r"),
    default=None,
    help="File with URLs (one per line). Use '-' for stdin.",
)
@click.option(
    "--prompt", "prompt_text", default=None, help="Natural language directive to focus extraction."
)
@click.option(
    "--prompt-file",
    type=click.File("r"),
    default=None,
    help="File containing extraction directive.",
)
@click.option(
    "--provider", default=None, help="LLM provider override (ollama, lmstudio, anthropic)."
)
@click.option("--model", "model_name", default=None, help="Model name override.")
@click.option("--location", default=None, help="Location hint (e.g. 'Austin, TX').")
@click.option("--issues", default=None, help="Comma-separated issue area slugs.")
@click.option(
    "--depth",
    type=click.Choice(["standard", "deep"]),
    default="standard",
    show_default=True,
    help="Discovery depth for place and issue runs.",
)
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option(
    "--follow-links/--no-follow-links",
    default=None,
    help="Follow same-domain links discovered during fetches.",
)
@click.option(
    "--max-link-depth",
    type=int,
    default=None,
    help="Maximum crawl depth when following discovered links.",
)
@click.option(
    "--max-pages-per-seed",
    type=int,
    default=None,
    help="Maximum total pages to queue from each seed URL.",
)
@click.option(
    "--refresh", is_flag=True, help="Bypass cached fetch and extraction results for this run."
)
@click.option(
    "--structured-columns",
    default=None,
    help=(
        "Comma-separated column names for headerless CSV/TSV/pipe resources. "
        "Used with direct URL runs."
    ),
)
@click.option(
    "--verbose-progress",
    is_flag=True,
    help="Show internal worker and queue events instead of the default user-facing firehose.",
)
@click.option(
    "--sync/--no-sync",
    "sync_after_run",
    default=None,
    help="Sync canonical run artifacts to Atlas after the run finishes.",
)
@click.option(
    "--target-count",
    type=click.IntRange(1),
    default=None,
    help="Target confirmed entries for a location run.",
)
@click.option("--quiet", "-q", is_flag=True, help="Suppress progress output.")
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
    structured_columns: str | None,
    verbose_progress: bool,
    sync_after_run: bool | None,
    target_count: int | None,
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
    Discover by place and issue:
        scout search connect
        scout run --location "Austin, TX" --issues housing_affordability
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
    structured_column_list = _parse_structured_columns(structured_columns)

    if follow_links is not None:
        config.scraper.follow_links = follow_links
    if max_link_depth is not None:
        config.scraper.max_link_depth = max_link_depth
    if max_pages_per_seed is not None:
        config.scraper.max_pages_per_seed = max_pages_per_seed

    # Validation
    resolved_search_key = search_api_key
    if not url_list:
        resolved_search_key = _resolve_search_connection(search_api_key)
        if not location:
            _exit_with_error(
                CliError(
                    title="Missing input",
                    message="Pass one or more URLs, or pass --location with --issues.",
                    hint=(
                        "Examples: scout run https://example.org/article | "
                        'scout run --location "Austin, TX" --issues housing_affordability. '
                        "Run `scout search connect` when you want Scout to find new sources."
                    ),
                )
            )
        if not issue_list:
            _exit_with_error(
                CliError(
                    title="Missing option",
                    message="--issues is required with --location.",
                    hint='Example: scout run --location "Austin, TX" --issues housing_affordability',
                )
            )

    try:
        resolution = _prepare_local_model_config(
            config,
            config_path=ctx.obj["config_path"],
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Local model unavailable", message=exc.message))

    if not quiet:
        profile = _runtime_profile_for_run(config, direct_mode=bool(url_list))
        _print_local_model_resolution(
            resolution,
            saved=bool(resolution and resolution.changed),
        )
        print_run_banner(
            console,
            config=config,
            profile=profile,
            refresh=refresh,
            directive=directive,
            location=location,
            url_count=len(url_list),
        )

    _run_async(
        _run_pipeline(
            config=config,
            location=location or "",
            issues=issue_list,
            depth=depth,
            search_api_key=resolved_search_key,
            direct_urls=url_list or None,
            quiet=quiet,
            directive=directive,
            refresh=refresh,
            structured_columns=structured_column_list,
            verbose_progress=verbose_progress,
            sync_after_run=sync_after_run,
            target_count=target_count,
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
    structured_columns: list[str] | None = None,
    verbose_progress: bool = False,
    sync_after_run: bool | None = None,
    sync_remote_run_id: str | None = None,
    target_count: int | None = None,
) -> None:
    """Create infrastructure, run the pipeline, print results."""
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    store = ScoutStore(str(db_path))
    await store.initialize()

    normalized_direct_urls = [normalize_url(url) for url in (direct_urls or []) if url.strip()]
    if normalized_direct_urls and not refresh:
        existing_run_id = await store.find_running_direct_run(normalized_direct_urls)
        if existing_run_id is not None:
            print_duplicate_run_notice(console, existing_run_id)
            await store.close()
            return

    profile = _runtime_profile_for_run(config, direct_mode=bool(direct_urls))
    provider = _build_provider(config, max_concurrent=profile.extract_concurrency)

    fetcher = AsyncFetcher(
        max_concurrent=profile.fetch_concurrency,
        request_delay_ms=config.scraper.request_delay_ms,
        page_cache_ttl_days=config.scraper.page_cache_ttl_days,
        revisit_cached_urls=config.scraper.revisit_cached_urls,
        store=store,
        run_id="pending",
        force_refresh=refresh,
        browser_fallback_enabled=config.scraper.browser_fallback_enabled,
        browser_render_timeout_ms=config.scraper.browser_render_timeout_ms,
        max_browser_renders_per_run=config.scraper.max_browser_renders_per_run,
        max_browser_concurrent=config.scraper.max_browser_concurrent,
    )
    progress = ProgressRenderer(console=console, quiet=quiet, verbose=verbose_progress)

    try:
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
                remote_run_id=sync_remote_run_id,
                structured_columns=structured_columns,
                target_count=target_count,
            )
        except ValueError as exc:
            _exit_with_error(CliError(title="Run could not start", message=str(exc)))
    finally:
        await _close_if_supported(fetcher)
        await _close_if_supported(provider)
        await store.close()

    print_run_results(console, result)
    if _should_sync_after_run(
        config,
        result_artifacts_available=result.artifacts is not None,
        sync_after_run=sync_after_run,
    ):
        await _runs_sync(
            config,
            result.run_id,
            atlas_url=None,
            api_key=None,
            target=None,
            workspace=None,
        )


def _build_provider(config: ScoutConfig, *, max_concurrent: int | None = None) -> LLMProvider:
    """Instantiate the configured LLM provider."""
    from atlas_scout.providers import create_provider

    return create_provider(config.llm, max_concurrent=max_concurrent)


def _parse_structured_columns(value: str | None) -> list[str] | None:
    """Parse comma-separated structured resource column names."""
    if value is None:
        return None
    columns = [column.strip() for column in value.split(",") if column.strip()]
    return columns or None
