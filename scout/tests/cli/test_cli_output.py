"""Tests for the generic Rich-backed Scout CLI output helpers."""

from __future__ import annotations

from rich.text import Text

from atlas_scout.cli_output import styled_status


def test_styled_status_known_status_uses_colour() -> None:
    text = styled_status("completed")
    assert isinstance(text, Text)
    assert text.style == "green"


def test_styled_status_unknown_status_falls_back_to_blank_style() -> None:
    text = styled_status("never-seen-before")
    assert text.style == ""
