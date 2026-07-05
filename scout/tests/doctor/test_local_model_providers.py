"""Doctor tests for local model providers."""

from __future__ import annotations

import httpx
import respx

from atlas_scout.config import ScoutConfig
from atlas_scout.doctor import _default_probe_model, run_doctor


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

    result = _default_probe_model(config)

    assert result.status == "ok"
    assert "LM Studio" in result.message


@respx.mock
def test_doctor_probe_explains_lmstudio_server_down() -> None:
    respx.get("http://localhost:1234/v1/models").mock(side_effect=httpx.ConnectError("down"))
    config = ScoutConfig()
    config.llm.provider = "lmstudio"
    config.llm.model = "qwen3:latest"

    result = _default_probe_model(config)

    assert result.status == "fail"
    assert "LM Studio" in result.message
    assert "lms server start" in str(result.remediation)


def test_worker_readiness_accepts_lmstudio_provider() -> None:
    config = ScoutConfig()
    config.llm.provider = "lmstudio"
    config.llm.model = "qwen3:latest"

    report = run_doctor(
        config,
        include_worker=True,
    )

    # The unauthenticated default doctor run should not complain about the provider itself.
    capability = report.capability("seeded-worker-jobs")
    assert capability is not None
    assert "local model provider" not in str(capability.remediation)
