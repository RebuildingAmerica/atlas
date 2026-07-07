"""Scout onboarding copy tests."""

from __future__ import annotations

from io import StringIO

from click.testing import CliRunner
from rich.console import Console

from atlas_scout.auth_output import print_login_success
from atlas_scout.cli import main


def test_root_help_points_to_scout_initiated_workflow() -> None:
    """The root help should make the discovery-first path obvious."""
    result = CliRunner().invoke(main, ["--help"])

    assert result.exit_code == 0
    assert "Start here" in result.output
    assert "scout login" in result.output
    assert "scout doctor" in result.output
    assert "scout run" in result.output
    assert "scout sync" in result.output


def test_login_success_points_to_doctor_next() -> None:
    """Login success should guide users toward readiness before work."""
    buffer = StringIO()
    console = Console(file=buffer, force_terminal=False, width=100)

    print_login_success(console, "willie@example.org")

    output = buffer.getvalue()
    assert "willie@example.org" in output
    assert "scout doctor" in output


def test_run_without_inputs_explains_discovery_modes() -> None:
    """Run validation should describe direct URL and search-backed discovery modes."""
    result = CliRunner().invoke(main, ["run"])

    assert result.exit_code != 0
    assert "Direct URL discovery" in result.output
    assert "Search-backed discovery" in result.output
