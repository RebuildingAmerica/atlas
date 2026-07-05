"""Structured Scout CLI error tests."""

from __future__ import annotations

import io

from rich.console import Console

from atlas_scout.cli_errors import CliError
from atlas_scout.cli_output import print_cli_error


def test_cli_error_renders_title_message_and_hint_to_configured_console() -> None:
    """Structured errors are rendered by the presentation layer."""
    stream = io.StringIO()
    test_console = Console(file=stream, force_terminal=False, color_system=None)

    print_cli_error(
        test_console,
        CliError(
            title="Login failed",
            message="Atlas auth returned HTTP 500 from https://atlas.localhost/device/code.",
            hint="Check the Atlas app logs.",
        ),
    )

    output = stream.getvalue()
    assert "Login failed:" in output
    assert "Atlas auth returned HTTP 500" in output
    assert "Check the Atlas app logs." in output
