"""Scout doctor sync readiness tests."""

from __future__ import annotations

from atlas_scout.config import ScoutConfig
from atlas_scout.doctor import DoctorDependencies, ProbeResult, run_doctor


def _dependencies(*, env: dict[str, str]) -> DoctorDependencies:
    return DoctorDependencies(
        check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
        has_search_key=lambda: False,
        load_session=lambda: None,
        load_worker_state=lambda: {"status": "stopped"},
        probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
        probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
        process_is_running=lambda _pid: False,
        env=env,
    )


def test_api_key_environment_enables_sync_without_browser_login() -> None:
    """Automation users can still sync with an Atlas API key."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_dependencies(env={"ATLAS_API_KEY": "secret-api-key"}),
    )

    assert report.capability("atlas-sync").ready
    assert "secret-api-key" not in report.to_json()


def test_missing_login_and_api_key_reports_sync_remediation() -> None:
    """Doctor should explain how to make Atlas sync available."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_dependencies(env={}),
    )

    sync = report.capability("atlas-sync")
    assert not sync.ready
    assert "scout login" in str(sync.remediation)
