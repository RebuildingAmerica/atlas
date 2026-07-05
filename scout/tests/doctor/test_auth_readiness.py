"""Scout doctor auth readiness tests."""

from __future__ import annotations

from atlas_scout.auth import ScoutSession
from atlas_scout.config import ScoutConfig
from atlas_scout.doctor import DoctorDependencies, ProbeResult, run_doctor


def _ready_dependencies(
    *,
    session: ScoutSession | None,
    search_key: bool = False,
) -> DoctorDependencies:
    return DoctorDependencies(
        check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
        has_search_key=lambda: search_key,
        load_session=lambda: session,
        load_worker_state=lambda: {"status": "stopped"},
        probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
        probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
        process_is_running=lambda _pid: False,
        env={},
    )


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


def test_missing_login_keeps_local_runs_available_but_blocks_sync() -> None:
    """Doctor should guide unauthenticated users without blocking local direct URL runs."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_ready_dependencies(session=None),
    )

    assert report.check("atlas-account").status == "warn"
    assert "scout login" in str(report.check("atlas-account").remediation)
    assert report.capability("direct-url-runs").ready
    assert not report.capability("atlas-sync").ready
    assert report.exit_code == 0


def test_login_session_enables_atlas_sync_without_printing_token() -> None:
    """Doctor should summarize the account and sync target without exposing secrets."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_ready_dependencies(session=_session()),
    )

    assert report.check("atlas-account").status == "ok"
    assert "willie@example.org" in report.check("atlas-account").message
    assert report.capability("atlas-sync").ready
    assert "secret-session-token" not in report.to_json()


def test_credential_store_failure_is_actionable() -> None:
    """A broken OS credential store should be a hard doctor failure."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=DoctorDependencies(
            check_credential_store=lambda: ProbeResult(
                "fail",
                "No OS credential store is available.",
                "Configure macOS Keychain, Windows Credential Manager, or Linux Secret Service.",
            ),
            has_search_key=lambda: False,
            load_session=lambda: None,
            load_worker_state=lambda: {"status": "stopped"},
            probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
            probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
            process_is_running=lambda _pid: False,
            env={},
        ),
    )

    assert report.check("credential-storage").status == "fail"
    assert report.exit_code == 1
