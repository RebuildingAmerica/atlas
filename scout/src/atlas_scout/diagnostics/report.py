"""Orchestrates Scout doctor's read-only readiness checks."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from atlas_scout.auth import load_session
from atlas_scout.diagnostics import probes
from atlas_scout.diagnostics.capabilities import (
    check_ready,
    discovery_capabilities,
    worker_readiness,
)
from atlas_scout.diagnostics.checks import (
    append_search_check,
    atlas_url,
    database_check,
    load_session_check,
    probe_check,
)
from atlas_scout.diagnostics.models import DoctorCheck, DoctorDependencies, DoctorReport
from atlas_scout.search_keys import has_search_api_key

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


def _default_dependencies() -> DoctorDependencies:
    """Wire Scout doctor's concrete, real-world adapters."""
    return DoctorDependencies(
        check_credential_store=probes.check_credential_store,
        has_search_key=has_search_api_key,
        load_session=load_session,
        load_worker_state=probes.load_worker_state,
        probe_atlas=probes.probe_atlas,
        probe_model=probes.probe_model,
        process_is_running=probes.process_is_running,
        env=os.environ,
    )


def run_doctor(
    config: ScoutConfig,
    *,
    include_worker: bool,
    dependencies: DoctorDependencies | None = None,
) -> DoctorReport:
    """Run read-only Scout readiness checks."""
    deps = dependencies or _default_dependencies()
    checks: list[DoctorCheck] = []

    credential_result = deps.check_credential_store()
    checks.append(
        DoctorCheck(
            id="credential-storage",
            group="Credential storage",
            label="OS credential store",
            status=credential_result.status,
            message=credential_result.message,
            remediation=credential_result.remediation,
        )
    )

    session = load_session_check(deps, checks)
    resolved_atlas_url = atlas_url(config, session)
    checks.append(
        probe_check(
            "atlas-connection", "Atlas connection", "Atlas", deps.probe_atlas(resolved_atlas_url)
        )
    )

    model_result = deps.probe_model(config)
    checks.append(
        probe_check(
            "model",
            "Local model",
            f"{config.llm.provider}:{config.llm.model}",
            model_result,
        )
    )

    search_key_ready = append_search_check(deps, checks)
    checks.append(database_check(config))

    capabilities = discovery_capabilities(
        config=config,
        checks=checks,
        session=session,
        search_key_ready=search_key_ready,
        env=deps.env,
    )
    if include_worker:
        worker_check, worker_capabilities = worker_readiness(
            config=config,
            dependencies=deps,
            session=session,
            search_key_ready=search_key_ready,
            model_ready=check_ready(checks, "model"),
        )
        checks.append(worker_check)
        capabilities.extend(worker_capabilities)

    return DoctorReport(checks=tuple(checks), capabilities=tuple(capabilities))
