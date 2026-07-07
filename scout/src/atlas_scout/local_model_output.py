"""Presentation helpers for Scout local-model onboarding."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rich.console import Console

    from atlas_scout.local_models import LocalModelResolution


def print_local_model_setup_help(
    console: Console,
    resolution: LocalModelResolution,
    *,
    default_model: str,
) -> None:
    """Print actionable local-model onboarding help."""
    console.print()
    console.print("[yellow]Local model not ready[/]")
    console.print("Scout needs a local chat model before it can run discovery on this computer.")
    if resolution.remediation:
        console.print(f"[dim]{resolution.remediation}[/]")
    console.print()
    console.print("[bold]Recommended[/]")
    console.print("  Install Ollama: https://ollama.com/download")
    console.print(f"  Then run: ollama pull {default_model}")
    console.print()
    console.print("[bold]Also supported[/]")
    console.print("  LM Studio: install a chat model, then start the local server.")
    console.print()
    console.print("[bold]Finish model setup[/]")
    console.print("  scout config model")
    console.print()
    console.print("[dim]Run `scout setup` again after a local model is running.[/]")
