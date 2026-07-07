"""Compatibility exports for callers that still patch ``atlas_scout.cli`` internals."""

from __future__ import annotations

import asyncio
import os
import platform
import signal
import subprocess
import sys
import time
import types
import webbrowser
from typing import TYPE_CHECKING

from atlas_scout import (
    auth as _auth,
)
from atlas_scout import (
    auth_commands as _auth_commands,
)
from atlas_scout import (
    cli_app as _cli_app,
)
from atlas_scout import (
    cli_common as _cli_common,
)
from atlas_scout import (
    cli_context as _cli_context,
)
from atlas_scout import (
    config as _config,
)
from atlas_scout import (
    config_commands as _config_commands,
)
from atlas_scout import (
    daemon_commands as _daemon_commands,
)
from atlas_scout import (
    db_commands as _db_commands,
)
from atlas_scout import (
    doctor_commands as _doctor_commands,
)
from atlas_scout import (
    entries_commands as _entries_commands,
)
from atlas_scout import (
    local_model_commands as _local_model_commands,
)
from atlas_scout import (
    local_models as _local_models,
)
from atlas_scout import (
    pages_commands as _pages_commands,
)
from atlas_scout import (
    pipeline_commands as _pipeline_commands,
)
from atlas_scout import (
    runs_commands as _runs_commands,
)
from atlas_scout import (
    runtime as _runtime,
)
from atlas_scout import (
    schedule_commands as _schedule_commands,
)
from atlas_scout import (
    search_keys as _search_keys,
)
from atlas_scout import (
    setup_commands as _setup_commands,
)
from atlas_scout import (
    worker_commands as _worker_commands,
)
from atlas_scout.daemon import formatting as _daemon_formatting
from atlas_scout.daemon import lifecycle as _daemon_lifecycle
from atlas_scout.daemon import process as _daemon_process
from atlas_scout.daemon import state as _daemon_state
from atlas_scout.diagnostics import report as _diagnostics_report
from atlas_scout.shared import atlas_urls as _atlas_urls
from atlas_scout.worker import api_client as _worker_api_client
from atlas_scout.worker import job as _worker_job
from atlas_scout.worker import lifecycle as _worker_lifecycle
from atlas_scout.worker import state as _worker_state

if TYPE_CHECKING:
    from collections.abc import MutableMapping

_STDLIB_EXPORTS: dict[str, object] = {
    "asyncio": asyncio,
    "os": os,
    "platform": platform,
    "signal": signal,
    "subprocess": subprocess,
    "time": time,
    "webbrowser": webbrowser,
}

_LEGACY_EXPORT_MODULES: tuple[tuple[types.ModuleType, tuple[str, ...]], ...] = (
    (_atlas_urls, ("DEFAULT_ATLAS_URL",)),
    (_auth, ("DeviceAuthClient", "delete_session", "load_session", "save_session")),
    (
        _auth_commands,
        (
            "_default_worker_name",
            "_load_session_or_click_exception",
            "_load_session_or_exit",
            "_login",
            "_poll_device_token",
            "_require_search_connection",
            "_resolve_search_connection",
            "_search_key_configured",
        ),
    ),
    (_cli_app, ("_resolved_profile_name",)),
    (
        _cli_common,
        (
            "ScoutSyncError",
            "_config_mutation_cli_error",
            "_credential_store_cli_error",
            "_exit_with_error",
            "_print_credential_store_error",
            "_run_async",
        ),
    ),
    (_cli_context, ("console", "err_console")),
    (
        _daemon_process,
        (
            "_daemon_process_is_running",
            "_install_daemon_signal_handlers",
            "_signal_daemon_process",
            "_spawn_daemon_process",
        ),
    ),
    (
        _daemon_state,
        (
            "_clear_failed_daemon_start",
            "_daemon_interval_metadata",
            "_daemon_start_claim_is_stale",
            "_daemon_start_conflict_message",
            "_open_store",
            "_require_schedule_targets",
            "_wait_for_daemon_start",
            "_wait_for_daemon_stop",
        ),
    ),
    (_daemon_formatting, ("_render_recent_run_summary", "_render_recent_tick_summary")),
    (
        _daemon_lifecycle,
        ("_daemon_run_internal", "_daemon_start", "_daemon_status", "_daemon_stop"),
    ),
    (
        _config,
        (
            "SCOUT_CONFIGS_DIR",
            "get_active_config_path",
            "get_active_profile_name",
            "load_config",
            "set_active_profile_name",
        ),
    ),
    (_diagnostics_report, ("run_doctor",)),
    (
        _local_model_commands,
        (
            "_choose_local_model_interactively",
            "_prepare_local_model_config",
            "_print_local_model_resolution",
            "_setup_local_model_provider",
        ),
    ),
    (_local_models, ("resolve_local_model",)),
    (
        _pipeline_commands,
        (
            "_build_provider",
            "_parse_structured_columns",
            "_run_pipeline",
            "_runtime_profile_for_run",
        ),
    ),
    (
        _runs_commands,
        (
            "_resolve_sync_run_ids",
            "_runs_inspect",
            "_runs_list",
            "_runs_sync",
            "_should_sync_after_run",
            "_sync_runs",
        ),
    ),
    (_runtime, ("build_runtime_profile",)),
    (_schedule_commands, ("_schedule_run_once", "_schedule_start")),
    (
        _search_keys,
        (
            "delete_stored_search_api_key",
            "has_search_api_key",
            "resolve_search_api_key",
            "save_search_api_key",
        ),
    ),
    (
        _setup_commands,
        (
            "SetupProfileChoice",
            "_install_completion_for_setup",
            "_install_man_pages_for_setup",
        ),
    ),
    (
        _worker_api_client,
        (
            "_worker_api_token",
            "_worker_claim_job",
            "_worker_complete_job",
            "_worker_fail_job",
            "_worker_heartbeat_job",
            "_worker_post",
        ),
    ),
    (_worker_job, ("_worker_process_job",)),
    (_worker_lifecycle, ("_spawn_worker_process",)),
    (
        _worker_state,
        ("WORKER_STATE_PATH", "_read_worker_state"),
    ),
)

_PATCH_TARGET_MODULES = (
    _cli_app,
    _auth_commands,
    _cli_common,
    _config_commands,
    _daemon_commands,
    _daemon_formatting,
    _daemon_lifecycle,
    _daemon_process,
    _daemon_state,
    _db_commands,
    _doctor_commands,
    _entries_commands,
    _local_model_commands,
    _pages_commands,
    _pipeline_commands,
    _runs_commands,
    _schedule_commands,
    _setup_commands,
    _worker_api_client,
    _worker_commands,
    _worker_job,
    _worker_lifecycle,
    _worker_state,
)


def _collect_legacy_exports() -> dict[str, object]:
    """Return the legacy ``atlas_scout.cli`` names grouped by source module."""
    exports = dict(_STDLIB_EXPORTS)
    for module, names in _LEGACY_EXPORT_MODULES:
        for name in names:
            exports[name] = getattr(module, name)
    return exports


_LEGACY_EXPORTS = _collect_legacy_exports()
LEGACY_EXPORT_NAMES = tuple(_LEGACY_EXPORTS)


class _CliFacadeModule(types.ModuleType):
    """Propagate legacy ``atlas_scout.cli`` monkeypatches to extracted modules."""

    def __setattr__(self, name: str, value: object) -> None:
        super().__setattr__(name, value)
        for module in _PATCH_TARGET_MODULES:
            if hasattr(module, name):
                setattr(module, name, value)


def install_legacy_cli_facade(
    module_name: str, namespace: MutableMapping[str, object]
) -> tuple[str, ...]:
    """Populate ``atlas_scout.cli`` with legacy names and patch propagation."""
    namespace.update(_LEGACY_EXPORTS)
    sys.modules[module_name].__class__ = _CliFacadeModule
    return LEGACY_EXPORT_NAMES
