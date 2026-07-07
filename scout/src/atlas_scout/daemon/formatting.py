"""Text formatting helpers for Scout daemon status output."""

from __future__ import annotations


def _render_recent_run_summary(run_record: dict[str, object] | None) -> str:
    """Format the most recent local run for daemon status output."""
    if run_record is None:
        return "none recorded"
    location = str(run_record.get("location") or "—")
    status = str(run_record.get("status") or "unknown")
    entries_value = run_record.get("entries_found")
    entries = entries_value if isinstance(entries_value, int) else 0
    return f"{run_record['id']} · {status} · {location} · {entries} entries"


def _render_recent_tick_summary(daemon_state: dict[str, object]) -> str:
    """Format the last scheduler tick summary from daemon state."""
    last_tick_summary = daemon_state.get("last_tick_summary")
    if not isinstance(last_tick_summary, dict):
        return "none recorded"
    summary = str(last_tick_summary.get("summary") or "no summary")
    completed_at = last_tick_summary.get("completed_at")
    if completed_at:
        return f"{summary} ({str(completed_at)[:19]})"
    return summary
