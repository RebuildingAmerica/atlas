"""Sync-receipt presentation for completed run syncs."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_scout.cli_context import console
from atlas_scout.runs.urls import _atlas_url_for_path

if TYPE_CHECKING:
    from atlas_shared import SyncedEntryLink

    from atlas_scout.steps.contribute import ContributionResult


def _sync_visibility_label(link: SyncedEntryLink) -> str:
    """Return a compact human label for a synced entry receipt."""
    if link.visibility == "public":
        return "public profile"
    if link.visibility == "existing_shared":
        return "existing public profile"
    if link.visibility == "workspace_private":
        return "workspace private"
    return "held for review"


def _print_sync_receipt(
    *,
    local_run_id: str,
    atlas_url: str,
    result: ContributionResult,
) -> None:
    """Print a developer-facing receipt for a completed run sync."""
    message = "Already synced" if result.duplicate else "Synced"
    console.print(f"[green]{message}[/] run {local_run_id} -> [bold]{result.run_id}[/]")
    if result.run_id:
        console.print(
            f"Open run: {_atlas_url_for_path(atlas_url, f'/discovery?run={result.run_id}')}"
        )

    if not result.entry_links:
        return

    console.print("Entries:")
    for link in result.entry_links[:10]:
        entry_url = _atlas_url_for_path(atlas_url, link.url) if link.url else None
        suffix = f" - {entry_url}" if entry_url else ""
        console.print(f"  {link.name} - {_sync_visibility_label(link)}{suffix}")
    remaining = len(result.entry_links) - 10
    if remaining > 0:
        console.print(f"  +{remaining} more")
