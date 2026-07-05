"""Presentation helpers for Scout CLI output."""

from __future__ import annotations

from typing import TYPE_CHECKING

from rich.table import Table
from rich.text import Text

from atlas_scout.cli_progress import filter_visible_page_outcomes

if TYPE_CHECKING:
    from rich.console import Console

    from atlas_scout.auth import DeviceAuthError
    from atlas_scout.config import ScoutConfig
    from atlas_scout.pipeline import PipelineResult
    from atlas_scout.runtime import RuntimeProfile

LOCAL_DEV_ATLAS_URL = "https://atlas.localhost:1355"

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


def format_device_auth_error(error: DeviceAuthError) -> str:
    """Format a structured auth failure for CLI presentation."""
    if error.description:
        return error.description

    if error.error == "network_error":
        endpoint = f" at {error.url}" if error.url else ""
        return (
            f"Could not reach Atlas auth{endpoint}. "
            f"Start Atlas with `pnpm dev` and use {LOCAL_DEV_ATLAS_URL} for local login."
        )

    if error.status_code is not None:
        endpoint = f" from {error.url}" if error.url else ""
        message = f"Atlas auth returned HTTP {error.status_code}{endpoint}."
        if _looks_like_wrong_auth_surface(error):
            return (
                f"{message} Check that --atlas-url points to the Atlas app URL, "
                f"not the API, docs, or another local server. Local development uses "
                f"{LOCAL_DEV_ATLAS_URL}."
            )
        return message

    return "Atlas auth returned an unexpected response."


def print_login_failure(console: Console, error: DeviceAuthError) -> None:
    """Print a login failure without leaking transport bodies."""
    console.print(f"[red]Login failed:[/] {format_device_auth_error(error)}")


def _looks_like_wrong_auth_surface(error: DeviceAuthError) -> bool:
    """Return whether an auth error likely came from the wrong local surface."""
    content_type = (error.content_type or "").lower()
    return (
        error.status_code in {404, 405}
        or "text/html" in content_type
        or "application/xhtml" in content_type
    )


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
            entries_value = outcome.get("entries", 0)
            entries_found = (
                entries_value
                if isinstance(entries_value, int) and not isinstance(entries_value, bool)
                else 0
            )
            if entries_found > 0:
                console.print(
                    f"  [{style}]{status}[/{style}]  {outcome['url']}  "
                    f"[bold]{entries_found} entries[/]"
                )
            elif outcome.get("error"):
                console.print(
                    f"  [{style}]{status}[/{style}]  {outcome['url']}  [dim]{outcome['error']}[/]"
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
