"""Capability readiness scoring and remediation text for Scout doctor."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_scout.diagnostics.checks import worker_state_check
from atlas_scout.diagnostics.models import DoctorCapability
from atlas_scout.local_models import LOCAL_PROVIDER_NAMES, is_local_provider

if TYPE_CHECKING:
    from collections.abc import Mapping

    from atlas_scout.auth import ScoutSession
    from atlas_scout.config import ScoutConfig
    from atlas_scout.diagnostics.models import DoctorCheck, DoctorDependencies


def discovery_capabilities(
    *,
    config: ScoutConfig,
    checks: list[DoctorCheck],
    session: ScoutSession | None,
    search_key_ready: bool,
    env: Mapping[str, str],
) -> list[DoctorCapability]:
    """Return Scout-initiated discovery and sync capabilities."""
    model_ready = check_ready(checks, "model")
    database_ready = check_ready(checks, "database")
    direct_ready = model_ready and database_ready
    sync_ready = _sync_ready(config, session, env)

    return [
        DoctorCapability(
            id="direct-url-runs",
            label="Direct URL runs",
            ready=direct_ready,
            message=(
                "Ready to run `scout run https://example.org`."
                if direct_ready
                else "Direct URL runs need a working model and local database."
            ),
            remediation=None if direct_ready else _first_remediation(checks, ["model", "database"]),
        ),
        DoctorCapability(
            id="search-discovery",
            label="Search discovery",
            ready=direct_ready and search_key_ready,
            message=(
                "Ready to run search-backed discovery."
                if direct_ready and search_key_ready
                else "Search discovery needs a working model, local database, and search connection."
            ),
            remediation=(
                None
                if direct_ready and search_key_ready
                else _first_remediation(checks, ["model", "database", "search"])
            ),
        ),
        DoctorCapability(
            id="atlas-sync",
            label="Atlas sync",
            ready=sync_ready,
            message=(
                "Ready to sync completed runs to Atlas."
                if sync_ready
                else "Atlas sync needs browser login or an Atlas API key."
            ),
            remediation=None if sync_ready else "Run `scout login` or set `ATLAS_API_KEY`.",
        ),
    ]


def worker_readiness(
    *,
    config: ScoutConfig,
    dependencies: DoctorDependencies,
    session: ScoutSession | None,
    search_key_ready: bool,
    model_ready: bool,
) -> tuple[DoctorCheck, list[DoctorCapability]]:
    """Return optional passive worker readiness."""
    state = dependencies.load_worker_state()
    worker_check = worker_state_check(state, dependencies.process_is_running)
    local_provider_ready = is_local_provider(config.llm.provider)
    base_ready = session is not None and local_provider_ready and model_ready
    remediation = _worker_remediation(
        session=session,
        local_provider_ready=local_provider_ready,
        model_ready=model_ready,
    )

    return (
        worker_check,
        [
            DoctorCapability(
                id="seeded-worker-jobs",
                label="Seeded Atlas worker jobs",
                ready=base_ready,
                message=(
                    "Ready for seeded Atlas worker jobs."
                    if base_ready
                    else "Seeded worker jobs need login and a local model provider."
                ),
                remediation=None if base_ready else remediation,
            ),
            DoctorCapability(
                id="search-worker-jobs",
                label="Search Atlas worker jobs",
                ready=base_ready and search_key_ready,
                message=(
                    "Ready for search-backed Atlas worker jobs."
                    if base_ready and search_key_ready
                    else "Search worker jobs need login, a local model provider, and a search connection."
                ),
                remediation=(
                    None
                    if base_ready and search_key_ready
                    else remediation or "Run `scout search connect`."
                ),
            ),
        ],
    )


def _worker_remediation(
    *,
    session: ScoutSession | None,
    local_provider_ready: bool,
    model_ready: bool,
) -> str:
    """Return the first action needed to make worker mode ready."""
    if session is None:
        return "Run `scout login`."
    if not local_provider_ready:
        allowed = ", ".join(LOCAL_PROVIDER_NAMES)
        return f"Run `scout config model` to choose a local model provider ({allowed})."
    if not model_ready:
        return "Run `scout config model` to choose a working local model."
    return "Run `scout search connect`."


def _sync_ready(
    config: ScoutConfig,
    session: ScoutSession | None,
    env: Mapping[str, str],
) -> bool:
    """Return whether sync has an authentication path."""
    return bool(
        session is not None
        or config.contribution.api_key.strip()
        or env.get("ATLAS_API_KEY", "").strip()
    )


def check_ready(checks: list[DoctorCheck], check_id: str) -> bool:
    """Return whether a check exists and passed."""
    return any(check.id == check_id and check.status == "ok" for check in checks)


def _first_remediation(checks: list[DoctorCheck], check_ids: list[str]) -> str | None:
    """Return the first remediation for a failed or warning dependency."""
    for check_id in check_ids:
        for check in checks:
            if check.id == check_id and check.status != "ok":
                return check.remediation
    return None
