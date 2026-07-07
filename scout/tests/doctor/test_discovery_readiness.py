"""Scout doctor discovery readiness tests."""

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


def _dependencies(*, search_key: bool) -> DoctorDependencies:
    return DoctorDependencies(
        check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
        has_search_key=lambda: search_key,
        load_session=_session,
        load_worker_state=lambda: {"status": "stopped"},
        probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
        probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
        process_is_running=lambda _pid: False,
        env={},
    )


def test_missing_search_key_is_warning_not_direct_run_blocker() -> None:
    """Direct URL discovery works without search connected, but search discovery does not."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_dependencies(search_key=False),
    )

    assert report.check("search").status == "warn"
    assert report.capability("direct-url-runs").ready
    assert not report.capability("search-discovery").ready
    assert report.capability("search-discovery").remediation == "Run `scout search connect`."
    assert report.exit_code == 0


def test_search_connection_enables_search_discovery_readiness() -> None:
    """Search-backed discovery should be ready once the model and search are ready."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_dependencies(search_key=True),
    )

    assert report.check("search").status == "ok"
    assert report.capability("search-discovery").ready


def test_model_failure_blocks_discovery_readiness() -> None:
    """A missing model should block both direct and search discovery capabilities."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=DoctorDependencies(
            check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
            has_search_key=lambda: True,
            load_session=_session,
            load_worker_state=lambda: {"status": "stopped"},
            probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
            probe_model=lambda _config: ProbeResult(
                "fail",
                "Ollama model llama3.1:8b is not available.",
                "Install the model with `ollama pull llama3.1:8b`.",
            ),
            process_is_running=lambda _pid: False,
            env={},
        ),
    )

    assert report.check("model").status == "fail"
    assert not report.capability("direct-url-runs").ready
    assert not report.capability("search-discovery").ready
    assert report.exit_code == 1
