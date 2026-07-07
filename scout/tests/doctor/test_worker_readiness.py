"""Scout doctor worker readiness tests."""

from __future__ import annotations

from atlas_scout.auth import ScoutSession
from atlas_scout.config import ScoutConfig
from atlas_scout.diagnostics import DoctorDependencies, ProbeResult, run_doctor


def _session() -> ScoutSession:
    return ScoutSession(
        atlas_url="https://atlas.example",
        access_token="secret-session-token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="willie@example.org",
        worker_name="Willies Mac",
        default_upload_target="public",
        workspace_id=None,
    )


def _dependencies(*, running: bool = False, search_key: bool = False) -> DoctorDependencies:
    return DoctorDependencies(
        check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
        has_search_key=lambda: search_key,
        load_session=_session,
        load_worker_state=lambda: {
            "process_id": 123,
            "status": "running",
            "worker_name": "Willies Mac",
        },
        probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
        probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
        process_is_running=lambda _pid: running,
        env={},
    )


def test_worker_capabilities_are_hidden_by_default() -> None:
    """Default doctor output should stay focused on user-initiated discovery."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_dependencies(running=True, search_key=True),
    )

    assert report.capability("seeded-worker-jobs") is None
    assert report.check("worker-state") is None


def test_worker_mode_reports_running_state_and_seeded_readiness() -> None:
    """The --worker view should include passive worker readiness."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=True,
        dependencies=_dependencies(running=True, search_key=False),
    )

    assert report.check("worker-state").status == "ok"
    assert "running" in report.check("worker-state").message
    assert report.capability("seeded-worker-jobs").ready
    assert not report.capability("search-worker-jobs").ready


def test_worker_mode_requires_local_provider() -> None:
    """Remote model providers should not be considered ready for public worker jobs."""
    config = ScoutConfig()
    config.llm.provider = "anthropic"

    report = run_doctor(
        config,
        include_worker=True,
        dependencies=_dependencies(running=False, search_key=True),
    )

    assert not report.capability("seeded-worker-jobs").ready
    assert "local model provider" in str(report.capability("seeded-worker-jobs").remediation)
