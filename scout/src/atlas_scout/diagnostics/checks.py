"""Individual DoctorCheck builders for Scout doctor readiness."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from atlas_scout.credentials import CredentialStoreError
from atlas_scout.diagnostics.models import DoctorCheck, ProbeResult
from atlas_scout.shared.atlas_urls import DEFAULT_ATLAS_URL

if TYPE_CHECKING:
    from collections.abc import Callable

    from atlas_scout.auth import ScoutSession
    from atlas_scout.config import ScoutConfig
    from atlas_scout.diagnostics.models import DoctorDependencies


def load_session_check(
    dependencies: DoctorDependencies,
    checks: list[DoctorCheck],
) -> ScoutSession | None:
    """Load the saved session and append the account check."""
    try:
        session = dependencies.load_session()
    except CredentialStoreError as exc:
        checks.append(
            DoctorCheck(
                id="atlas-account",
                group="Atlas account",
                label="Account",
                status="fail",
                message=str(exc),
                remediation="Run `scout logout` and `scout login` after fixing credential storage.",
            )
        )
        return None

    if session is None:
        checks.append(
            DoctorCheck(
                id="atlas-account",
                group="Atlas account",
                label="Account",
                status="warn",
                message="Not logged in.",
                remediation="Run `scout login`.",
            )
        )
        return None

    target = session.default_upload_target or "public"
    checks.append(
        DoctorCheck(
            id="atlas-account",
            group="Atlas account",
            label="Account",
            status="ok",
            message=(f"Signed in as {session.user_email}. Uploads default to {target}."),
            remediation=None,
        )
    )
    return session


def probe_check(
    check_id: str,
    group: str,
    label: str,
    result: ProbeResult,
) -> DoctorCheck:
    """Convert a probe result into a grouped doctor check."""
    return DoctorCheck(
        id=check_id,
        group=group,
        label=label,
        status=result.status,
        message=result.message,
        remediation=result.remediation,
    )


def append_search_check(
    dependencies: DoctorDependencies,
    checks: list[DoctorCheck],
) -> bool:
    """Append search-backed discovery readiness and return whether search is available."""
    try:
        search_key_ready = dependencies.has_search_key()
    except CredentialStoreError as exc:
        checks.append(
            DoctorCheck(
                id="search",
                group="Search",
                label="Search connection",
                status="fail",
                message=str(exc),
                remediation="Run `scout search disconnect`, then `scout search connect`.",
            )
        )
        return False

    if search_key_ready:
        checks.append(
            DoctorCheck(
                id="search",
                group="Search",
                label="Search connection",
                status="ok",
                message="Search-backed discovery is available.",
                remediation=None,
            )
        )
        return True

    checks.append(
        DoctorCheck(
            id="search",
            group="Search",
            label="Search connection",
            status="warn",
            message="Search-backed discovery is not connected.",
            remediation="Run `scout search connect`.",
        )
    )
    return False


def database_check(config: ScoutConfig) -> DoctorCheck:
    """Check whether Scout can use the configured local database path."""
    db_path = Path(config.store.path).expanduser()
    nearest_parent = _nearest_existing_parent(db_path.parent)
    if nearest_parent is None:
        return DoctorCheck(
            id="database",
            group="Local data",
            label="Database",
            status="fail",
            message=f"No existing parent directory for {db_path}.",
            remediation="Choose a database path under a writable directory.",
        )
    if os.access(nearest_parent, os.W_OK):
        return DoctorCheck(
            id="database",
            group="Local data",
            label="Database",
            status="ok",
            message=f"Local database path is {db_path}.",
            remediation=None,
        )
    return DoctorCheck(
        id="database",
        group="Local data",
        label="Database",
        status="fail",
        message=f"Scout cannot write under {nearest_parent}.",
        remediation="Choose a writable database path with `scout config set store.path ...`.",
    )


def worker_state_check(
    state: dict[str, object],
    process_is_running: Callable[[int], bool],
) -> DoctorCheck:
    """Summarize the local worker state file."""
    status = str(state.get("status", "stopped"))
    process_id = state.get("process_id")
    if status == "running" and isinstance(process_id, int):
        if process_is_running(process_id):
            return DoctorCheck(
                id="worker-state",
                group="Worker",
                label="Worker",
                status="ok",
                message=f"Worker is running with PID {process_id}.",
                remediation=None,
            )
        return DoctorCheck(
            id="worker-state",
            group="Worker",
            label="Worker",
            status="warn",
            message="Worker state is stale.",
            remediation="Run `scout worker stop`, then `scout worker start`.",
        )
    if status == "error":
        return DoctorCheck(
            id="worker-state",
            group="Worker",
            label="Worker",
            status="warn",
            message=f"Worker last reported an error: {state.get('last_error', 'unknown error')}.",
            remediation="Run `scout worker status` for details.",
        )
    return DoctorCheck(
        id="worker-state",
        group="Worker",
        label="Worker",
        status="warn",
        message="Worker is not running.",
        remediation="Run `scout worker start` when you want Atlas to assign background work.",
    )


def atlas_url(config: ScoutConfig, session: ScoutSession | None) -> str:
    """Return the Atlas URL doctor should probe."""
    if session is not None and session.atlas_url.strip():
        return session.atlas_url.rstrip("/")
    if config.contribution.atlas_url.strip():
        return config.contribution.atlas_url.rstrip("/")
    return DEFAULT_ATLAS_URL


def _nearest_existing_parent(path: Path) -> Path | None:
    """Return the nearest existing parent directory."""
    candidate = path
    while not candidate.exists():
        if candidate.parent == candidate:
            return None
        candidate = candidate.parent
    return candidate if candidate.is_dir() else candidate.parent
