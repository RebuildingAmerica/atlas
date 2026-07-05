"""Regression tests for running Scout as a Python module."""

from __future__ import annotations

import subprocess
import sys


def test_cli_module_entrypoint_invokes_click() -> None:
    """`python -m atlas_scout.cli` should behave like the installed scout command."""
    result = subprocess.run(
        [sys.executable, "-m", "atlas_scout.cli", "--help"],
        capture_output=True,
        check=False,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0
    assert "Atlas Scout" in result.stdout
    assert "Commands:" in result.stdout
