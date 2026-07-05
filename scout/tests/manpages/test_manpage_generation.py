"""Man page generation tests for Scout."""

from __future__ import annotations

import click

from atlas_scout.manpages import collect_man_pages


def test_collect_man_pages_walks_public_click_commands() -> None:
    """Man pages are generated from the actual Click command tree."""
    cli = _example_cli()

    pages = collect_man_pages(cli, command_name="scout", current_date="2026-07-05")

    assert tuple(page.filename for page in pages) == (
        "scout.1",
        "scout-login.1",
        "scout-runs.1",
        "scout-runs-sync.1",
    )


def test_collect_man_pages_uses_command_help_content() -> None:
    """Generated pages should be useful when read through standard man tooling."""
    cli = _example_cli()

    pages = collect_man_pages(cli, command_name="scout", current_date="2026-07-05")
    login_page = next(page for page in pages if page.filename == "scout-login.1")

    assert '.TH "SCOUT-LOGIN" "1" "2026-07-05" "Atlas Scout" "Atlas Scout Manual"' in (
        login_page.content
    )
    assert ".SH NAME" in login_page.content
    assert "scout\\-login \\- Log in to Atlas." in login_page.content
    assert ".SH SYNOPSIS" in login_page.content
    assert "\\fBscout login\\fR" in login_page.content
    assert ".SH OPTIONS" in login_page.content
    assert "\\fB\\-\\-atlas\\-url\\fR" in login_page.content


def test_collect_man_pages_escapes_roff_sensitive_text() -> None:
    """User-facing help should not accidentally become roff control syntax."""

    @click.command(help=".Leading text - and a literal backslash \\.")
    def cli() -> None:
        pass

    page = collect_man_pages(cli, command_name="scout", current_date="2026-07-05")[0]

    assert "\\&.Leading text \\- and a literal backslash \\\\." in page.content


def _example_cli() -> click.Group:
    @click.group(help="Scout root command.")
    def cli() -> None:
        pass

    @cli.command(help="Log in to Atlas.")
    @click.option("--atlas-url", help="Atlas app URL.")
    def login() -> None:
        pass

    @cli.command(hidden=True, help="Internal package helper.")
    def internal() -> None:
        pass

    @cli.group(help="Manage runs.")
    def runs() -> None:
        pass

    @runs.command(help="Sync a run.")
    def sync() -> None:
        pass

    return cli
