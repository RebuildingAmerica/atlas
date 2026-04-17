"""Presentation helpers for Scout CLI output."""

from __future__ import annotations

from typing import TYPE_CHECKING

from rich.table import Table
from rich.text import Text

from atlas_scout.cli_progress import filter_visible_page_outcomes

if TYPE_CHECKING:
    from rich.console import Console

    from atlas_scout.config import ScoutConfig
    from atlas_scout.pipeline import PipelineResult
    from atlas_scout.runtime import RuntimeProfile

STATUS_STYLES: dict[str, str] = {
    "completed": "green",
    "extracted": "green",
    "fetched": "cyan",
    "running": "yellow",
    "pending": "dim",
    "queued": "dim",
    "fetching": "yellow",
    "extracting": "yellow",
    "filtered": "yellow",
    "extract_empty": "yellow",
    "failed": "red",
    "fetch_failed": "red",
    "extract_failed": "red",
}


def styled_status(status: str) -> Text:
    """Return a Rich Text with color for a pipeline status string."""
    return Text(status, style=STATUS_STYLES.get(status, ""))


def print_run_banner(
    console: Console,
    *,
    config: ScoutConfig,
    profile: RuntimeProfile,
    refresh: bool,
    directive: str | None,
    location: str | None,
    url_count: int,
) -> None:
    """Print the user-facing run header before the pipeline starts."""
    console.print(f"[bold]Model:[/] {config.llm.model} [dim](via {config.llm.provider})[/]")
    console.print(
        f"[bold]Runtime:[/] search={profile.search_concurrency} "
        f"fetch={profile.fetch_concurrency} extract={profile.extract_concurrency}"
    )
    console.print(
        f"[bold]Link Following:[/] "
        f"{'enabled' if config.scraper.follow_links else 'disabled'} "
        f"depth={config.scraper.max_link_depth} "
        f"max_pages_per_seed={config.scraper.max_pages_per_seed}"
    )
    console.print(f"[bold]Cache:[/] {'refresh' if refresh else 'reuse'}")
    if directive:
        console.print(f"[bold]Focus:[/] {directive}")
    if location:
        console.print(f"[bold]Location:[/] {location}")
    if url_count:
        console.print(f"[bold]URLs:[/] {url_count}")
    console.print()


def print_duplicate_run_notice(console: Console, run_id: str) -> None:
    """Print the duplicate-run preflight notice."""
    console.print()
    console.print(f"[yellow]Active run already exists:[/] {run_id}")
    console.print(
        "[dim]Scout did not start duplicate direct-url work. "
        "Wait for that run to finish, inspect it with `scout runs inspect`, "
        "or use `--refresh` if you really want a new run.[/]"
    )


def print_run_results(console: Console, result: PipelineResult) -> None:
    """Print the post-run summary, page outcomes, and ranked entries."""
    console.print()
    console.print(f"[bold]Run ID:[/] {result.run_id}")
    console.print(
        f"  Queries: {result.queries_generated}  "
        f"Pages: {result.pages_fetched}  "
        f"Entries: {result.entries_found}"
    )

    visible_page_outcomes = filter_visible_page_outcomes(result.page_outcomes)
    if visible_page_outcomes:
        console.print()
        for outcome in visible_page_outcomes:
            status = str(outcome["status"])
            style = STATUS_STYLES.get(status, "")
            entries_found = int(outcome.get("entries", 0))
            if entries_found > 0:
                console.print(
                    f"  [{style}]{status}[/{style}]  {outcome['url']}  "
                    f"[bold]{entries_found} entries[/]"
                )
            elif outcome.get("error"):
                console.print(
                    f"  [{style}]{status}[/{style}]  {outcome['url']}  "
                    f"[dim]{outcome['error']}[/]"
                )
            else:
                console.print(f"  [{style}]{status}[/{style}]  {outcome['url']}")

    if result.ranked_entries:
        table = Table(title="Discovered Entries", show_lines=False, pad_edge=False)
        table.add_column("Score", style="bold", width=6, justify="right")
        table.add_column("Type", style="dim")
        table.add_column("Name")
        table.add_column("Location")
        for ranked in result.ranked_entries[:15]:
            table.add_row(
                f"{ranked.score:.2f}",
                str(ranked.entry.entry_type),
                ranked.entry.name,
                f"{ranked.entry.city or '?'}, {ranked.entry.state or '?'}",
            )
        console.print()
        console.print(table)
        return

    console.print("\n[dim]No entities discovered.[/]")
