"""Shared consoles for Scout CLI modules."""

from __future__ import annotations

from rich.console import Console

console = Console()
err_console = Console(stderr=True)
