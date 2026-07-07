"""Run history and sync helpers for Scout.

Public API facade over the runs/ package: Atlas URL construction (urls),
sync-receipt presentation (receipt), sync resolution and execution (sync),
and run listing/inspection/cancellation (history).
"""

from __future__ import annotations

from atlas_scout.runs.history import (
    _TERMINAL_RUN_STATUSES,
    _runs_cancel,
    _runs_inspect,
    _runs_list,
)
from atlas_scout.runs.receipt import _print_sync_receipt, _sync_visibility_label
from atlas_scout.runs.sync import (
    _resolve_sync_run_ids,
    _runs_sync,
    _should_sync_after_run,
    _sync_runs,
)
from atlas_scout.runs.urls import _atlas_url_for_path

__all__ = [
    "_TERMINAL_RUN_STATUSES",
    "_atlas_url_for_path",
    "_print_sync_receipt",
    "_resolve_sync_run_ids",
    "_runs_cancel",
    "_runs_inspect",
    "_runs_list",
    "_runs_sync",
    "_should_sync_after_run",
    "_sync_runs",
    "_sync_visibility_label",
]
