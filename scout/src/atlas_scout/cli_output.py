"""Generic presentation helpers shared across Scout CLI verticals."""

from __future__ import annotations

from typing import TYPE_CHECKING

from rich.text import Text

if TYPE_CHECKING:
    from rich.console import Console

    from atlas_scout.cli_errors import CliError

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


def print_cli_error(console: Console, error: CliError) -> None:
    """Render one structured CLI error."""
    console.print(f"[red]{error.title}:[/] {error.message}", soft_wrap=True)
    if error.hint:
        console.print(f"[dim]{error.hint}[/]", soft_wrap=True)
