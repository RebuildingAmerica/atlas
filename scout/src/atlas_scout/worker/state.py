"""Local Atlas worker state file persistence."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import cast

from atlas_scout.config import SCOUT_CONFIG_DIR
from atlas_scout.credentials import CredentialStoreError
from atlas_scout.daemon import _daemon_process_is_running
from atlas_scout.search_keys import resolve_search_api_key

WORKER_STATE_PATH = SCOUT_CONFIG_DIR / "worker.json"
_WORKER_STOPPED_STATE: dict[str, object] = {
    "atlas_url": None,
    "current_job_id": None,
    "last_completed_job_id": None,
    "last_error": None,
    "last_heartbeat_at": None,
    "mode": "stopped",
    "process_id": None,
    "search_key_configured": False,
    "started_at": None,
    "status": "stopped",
    "worker_id": None,
    "worker_name": None,
}


def _now_iso() -> str:
    """Return a UTC timestamp for worker state files."""
    return datetime.now(UTC).isoformat()


def _read_worker_state() -> dict[str, object]:
    """Read the local Atlas worker state file."""
    if not WORKER_STATE_PATH.exists():
        return {"status": "stopped"}
    with WORKER_STATE_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {"status": "stopped"}
    return cast("dict[str, object]", payload)


def _write_worker_state(**state: object) -> None:
    """Persist local Atlas worker state."""
    payload = {**_read_worker_state(), **state, "updated_at": _now_iso()}
    WORKER_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with WORKER_STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    WORKER_STATE_PATH.chmod(0o600)


def _write_stopped_worker_state() -> None:
    """Persist a stopped worker state without stale live metadata."""
    _write_worker_state(**_WORKER_STOPPED_STATE)


def _worker_state_running(state: dict[str, object]) -> bool:
    """Return whether the tracked Atlas worker process is running."""
    process_id = state.get("process_id")
    return (
        state.get("status") == "running"
        and isinstance(process_id, int)
        and _daemon_process_is_running(process_id)
    )


def _resolve_optional_worker_search_key(search_api_key: str | None) -> str:
    """Return a search key for worker jobs, or empty when storage is unavailable."""
    try:
        return resolve_search_api_key(search_api_key)
    except CredentialStoreError:
        return ""
