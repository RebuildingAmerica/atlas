"""Scout doctor sync readiness tests."""

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


def _dependencies(
    *,
    env: dict[str, str],
    session: ScoutSession | None = None,
    sync_probe: ProbeResult | None = None,
) -> DoctorDependencies:
    return DoctorDependencies(
        check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
        has_search_key=lambda: False,
        load_session=lambda: session,
        load_worker_state=lambda: {"status": "stopped"},
        probe_atlas=lambda atlas_url: ProbeResult("ok", f"{atlas_url} reachable."),
        probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
        probe_session_sync_token=lambda _atlas_url, _session, _search_key: (
            sync_probe or ProbeResult("ok", "Saved Scout login can mint Atlas upload tokens.")
        ),
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


def test_saved_session_with_failed_token_exchange_blocks_sync_readiness() -> None:
    """A stale browser login should not be reported as ready to upload."""
    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        dependencies=_dependencies(
            env={},
            session=_session(),
            sync_probe=ProbeResult(
                "warn",
                "Saved Scout login could not mint an Atlas upload token.",
                "Run `scout login --atlas-url https://atlas.example` again.",
            ),
        ),
    )

    token_check = report.check("atlas-sync-token")
    assert token_check is not None
    assert token_check.status == "warn"
    sync = report.capability("atlas-sync")
    assert not sync.ready
    assert sync.remediation == "Run `scout login --atlas-url https://atlas.example` again."
    assert report.exit_code == 0


def test_atlas_url_override_targets_connection_and_session_probe() -> None:
    """Doctor should validate the environment the operator asked about."""
    probed_urls: list[str] = []
    token_urls: list[str] = []

    report = run_doctor(
        ScoutConfig(),
        include_worker=False,
        atlas_url="https://atlas.example",
        dependencies=DoctorDependencies(
            check_credential_store=lambda: ProbeResult("ok", "OS credential store available."),
            has_search_key=lambda: False,
            load_session=lambda: _session(),
            load_worker_state=lambda: {"status": "stopped"},
            probe_atlas=lambda atlas_url: (
                probed_urls.append(atlas_url) or ProbeResult("ok", f"{atlas_url} reachable.")
            ),
            probe_model=lambda _config: ProbeResult("ok", "Ollama model available."),
            probe_session_sync_token=lambda atlas_url, _session, _search_key: (
                token_urls.append(atlas_url)
                or ProbeResult("ok", "Saved Scout login can mint Atlas upload tokens.")
            ),
            process_is_running=lambda _pid: False,
            env={},
        ),
    )

    assert report.capability("atlas-sync").ready
    assert probed_urls == ["https://atlas.example"]
    assert token_urls == ["https://atlas.example"]
