"""Doctor tests for local model providers."""

from __future__ import annotations

import httpx
import pytest
import respx

from atlas_scout.auth import ScoutSession
from atlas_scout.config import ScoutConfig
from atlas_scout.diagnostics import DoctorDependencies, ProbeResult, run_doctor
from atlas_scout.diagnostics.probes import probe_model


@respx.mock
def test_doctor_probe_accepts_lmstudio_model() -> None:
    respx.get("http://localhost:1234/v1/models").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "qwen3:latest"}]},
        )
    )
    config = ScoutConfig()
    config.llm.provider = "lmstudio"
    config.llm.model = "qwen3:latest"

    result = probe_model(config)

    assert result.status == "ok"
    assert "LM Studio" in result.message


@respx.mock
def test_doctor_probe_explains_lmstudio_server_down() -> None:
    respx.get("http://localhost:1234/v1/models").mock(side_effect=httpx.ConnectError("down"))
    config = ScoutConfig()
    config.llm.provider = "lmstudio"
    config.llm.model = "qwen3:latest"

    result = probe_model(config)

    assert result.status == "fail"
    assert "LM Studio" in result.message
    assert "lms server start" in str(result.remediation)


def test_worker_readiness_accepts_lmstudio_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse_system_dependencies() -> None:
        pytest.fail("This model-readiness test must not access native credentials or live services")

    monkeypatch.setattr(
        "atlas_scout.diagnostics.report._default_dependencies", refuse_system_dependencies
    )

    config = ScoutConfig()
    config.llm.provider = "lmstudio"
    config.llm.model = "qwen3:latest"

    report = run_doctor(
        config,
        include_worker=True,
        dependencies=DoctorDependencies(
            check_credential_store=lambda: ProbeResult("ok", "Test credential store available."),
            has_search_key=lambda: False,
            load_session=lambda: ScoutSession(
                atlas_url="https://atlas.example",
                access_token="test-session-token",
                worker_id="worker-123",
                user_id="user-123",
                user_email="worker@example.org",
                worker_name="Test worker",
                default_upload_target="public",
                workspace_id=None,
            ),
            load_worker_state=lambda: {"status": "stopped"},
            probe_atlas=lambda _: ProbeResult("ok", "Test Atlas reachable."),
            probe_model=lambda _: ProbeResult("ok", "LM Studio model available."),
            probe_session_sync_token=lambda *_: ProbeResult("ok", "Test upload token ready."),
            process_is_running=lambda _: False,
            env={},
        ),
    )

    capability = report.capability("seeded-worker-jobs")
    assert capability is not None
    assert capability.ready
    assert capability.remediation is None
