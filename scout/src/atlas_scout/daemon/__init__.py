"""Daemon lifecycle helpers for the Atlas Scout CLI.

Public API facade over the daemon/ package: OS process control shared with
the worker subsystem (process), store-backed start/stop reconciliation
(state), status text formatting (formatting), and the start/stop/status/
run-internal orchestrators (lifecycle).
"""

from __future__ import annotations

from atlas_scout.daemon.formatting import _render_recent_run_summary, _render_recent_tick_summary
from atlas_scout.daemon.lifecycle import (
    _daemon_run_internal,
    _daemon_start,
    _daemon_status,
    _daemon_stop,
)
from atlas_scout.daemon.process import (
    _daemon_process_is_running,
    _install_daemon_signal_handlers,
    _signal_daemon_process,
    _spawn_daemon_process,
    spawn_detached_scout_process,
)
from atlas_scout.daemon.state import (
    _clear_failed_daemon_start,
    _daemon_interval_metadata,
    _daemon_start_claim_is_stale,
    _daemon_start_conflict_message,
    _open_store,
    _require_schedule_targets,
    _wait_for_daemon_start,
    _wait_for_daemon_stop,
)

__all__ = [
    "_clear_failed_daemon_start",
    "_daemon_interval_metadata",
    "_daemon_process_is_running",
    "_daemon_run_internal",
    "_daemon_start",
    "_daemon_start_claim_is_stale",
    "_daemon_start_conflict_message",
    "_daemon_status",
    "_daemon_stop",
    "_install_daemon_signal_handlers",
    "_open_store",
    "_render_recent_run_summary",
    "_render_recent_tick_summary",
    "_require_schedule_targets",
    "_signal_daemon_process",
    "_spawn_daemon_process",
    "_wait_for_daemon_start",
    "_wait_for_daemon_stop",
    "spawn_detached_scout_process",
]
