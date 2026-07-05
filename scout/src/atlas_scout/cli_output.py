"""Presentation helpers for Scout CLI output."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import qrcode  # type: ignore[import-untyped]
from rich.table import Table
from rich.text import Text

from atlas_scout.cli_errors import CliError
from atlas_scout.cli_progress import filter_visible_page_outcomes

if TYPE_CHECKING:
    from rich.console import Console

    from atlas_scout.auth import DeviceAuthError, DeviceCode
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

USER_CODE_GROUP_SIZE = 4


def styled_status(status: str) -> Text:
    """Return a Rich Text with color for a pipeline status string."""
    return Text(status, style=STATUS_STYLES.get(status, ""))


def format_device_auth_error(error: DeviceAuthError) -> str:
    """Format a structured auth failure for CLI presentation."""
    if error.error == "access_denied":
        return "Scout login was denied in the browser. Run `scout login` again to retry."

    if error.error == "expired_token":
        return "That Scout login code expired. Run `scout login` again to get a new code."

    if error.error == "invalid_response":
        return "Atlas auth returned an unexpected response. Update Scout and try again."

    if error.description and not _is_generic_auth_description(error.description):
        return error.description

    if error.error == "network_error":
        endpoint = f" at {error.url}" if error.url else ""
        return f"Could not reach Atlas auth{endpoint}. Check your connection and --atlas-url."

    if error.status_code is not None:
        endpoint = f" from {error.url}" if error.url else ""
        message = f"Atlas auth returned HTTP {error.status_code}{endpoint}."
        if _looks_like_wrong_auth_surface(error):
            return (
                f"{message} Check that --atlas-url points to the Atlas app URL, "
                "not the API, docs, or another server."
            )
        return message

    return "Atlas auth returned an unexpected response."


def print_login_failure(console: Console, error: DeviceAuthError) -> None:
    """Print a login failure without leaking transport bodies."""
    print_cli_error(
        console, CliError(title="Login failed", message=format_device_auth_error(error))
    )


def print_cli_error(console: Console, error: CliError) -> None:
    """Render one structured CLI error."""
    console.print(f"[red]{error.title}:[/] {error.message}", soft_wrap=True)
    if error.hint:
        console.print(f"[dim]{error.hint}[/]", soft_wrap=True)


def print_login_instructions(console: Console, code: DeviceCode) -> None:
    """Print device-authorization instructions for Scout login."""
    verification_uri_complete = format_verification_uri_complete(code)
    user_code = format_user_code(code.user_code)

    console.print()
    console.print("[bold]Atlas Scout login[/]")
    console.print()
    console.print("Scout needs permission to connect this computer to your Atlas account.")
    console.print()
    console.print("[bold]Scan this QR code[/]")
    console.print(_render_qr_code(verification_uri_complete))
    console.print()
    console.print("Or open this approval page:")
    console.print(f"  {code.verification_uri}")
    console.print()
    console.print("Confirm this code in the browser:")
    console.print(f"  [bold]{user_code}[/]")
    console.print()
    console.print(
        "[dim]Waiting for approval. Scout will finish automatically after you approve.[/]"
    )


def print_login_success(console: Console, email: str) -> None:
    """Print the successful login identity."""
    console.print()
    console.print(f"[green]Logged in as[/] [bold]{email}[/]")
    console.print("[dim]Run `scout doctor` to check this computer before discovery work.[/]")


def format_user_code(user_code: str) -> str:
    """Return a human-readable device user code."""
    normalized = "".join(character for character in user_code.upper() if character.isalnum())
    groups = [
        normalized[index : index + USER_CODE_GROUP_SIZE]
        for index in range(0, len(normalized), USER_CODE_GROUP_SIZE)
    ]
    return "-".join(groups)


def format_verification_uri_complete(code: DeviceCode) -> str:
    """Return the complete verification URI with the display-formatted user code."""
    if code.verification_uri_complete is None:
        return code.verification_uri

    parsed_uri = urlsplit(code.verification_uri_complete)
    formatted_user_code = format_user_code(code.user_code)
    query_items = parse_qsl(parsed_uri.query, keep_blank_values=True)
    updated_query_items: list[tuple[str, str]] = []
    found_user_code = False
    for key, value in query_items:
        if key == "user_code":
            updated_query_items.append((key, formatted_user_code))
            found_user_code = True
        else:
            updated_query_items.append((key, value))
    if not found_user_code:
        updated_query_items.append(("user_code", formatted_user_code))

    return urlunsplit(
        (
            parsed_uri.scheme,
            parsed_uri.netloc,
            parsed_uri.path,
            urlencode(updated_query_items),
            parsed_uri.fragment,
        )
    )


def _render_qr_code(data: str) -> str:
    """Render a terminal QR code for the complete verification URI."""
    qr = qrcode.QRCode(border=2)
    qr.add_data(data)
    qr.make(fit=True)
    output = io.StringIO()
    qr.print_ascii(out=output)
    return output.getvalue().rstrip()


def _looks_like_wrong_auth_surface(error: DeviceAuthError) -> bool:
    """Return whether an auth error likely came from the wrong local surface."""
    content_type = (error.content_type or "").lower()
    return (
        error.status_code in {404, 405}
        or "text/html" in content_type
        or "application/xhtml" in content_type
    )


def _is_generic_auth_description(description: str) -> bool:
    """Return whether a server error description is too vague to show alone."""
    normalized = description.strip().lower()
    return normalized in {
        "error",
        "httperror",
        "http error",
        "internal server error",
        "requesterror",
        "request error",
        "server error",
    }


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
