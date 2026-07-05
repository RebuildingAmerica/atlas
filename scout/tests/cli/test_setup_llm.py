"""Scout local LLM setup command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
from atlas_scout.config import ScoutConfig
from atlas_scout.local_models import LocalModelResolution

if TYPE_CHECKING:
    from pathlib import Path


def _resolution(*, ready: bool = True) -> LocalModelResolution:
    return LocalModelResolution(
        ready=ready,
        provider="lmstudio" if ready else None,
        model="qwen3:latest" if ready else None,
        base_url="http://localhost:1234/v1" if ready else None,
        message="Using LM Studio with qwen3:latest." if ready else "No local model is ready.",
        remediation=None if ready else "Start Ollama or LM Studio, then run `scout setup llm`.",
        changed=ready,
    )


def test_setup_llm_auto_saves_detected_provider(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: _resolution())

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup", "llm"])

    assert result.exit_code == 0, result.output
    assert "Using LM Studio with qwen3:latest" in result.output
    assert "Saved local model settings" in result.output
    text = config_path.read_text(encoding="utf-8")
    assert 'provider = "lmstudio"' in text
    assert 'model = "qwen3:latest"' in text
    assert 'base_url = "http://localhost:1234/v1"' in text


def test_setup_runs_onboarding_login_and_local_model_setup(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    captured: dict[str, object] = {}

    async def login(**kwargs: object) -> None:
        captured["login"] = kwargs

    monkeypatch.setattr(cli_module, "load_session", lambda: None)
    monkeypatch.setattr(cli_module, "_login", login)
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: _resolution())

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "setup",
            "--atlas-url",
            "https://atlas.localhost",
            "--no-browser",
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["login"] == {
        "atlas_url": "https://atlas.localhost",
        "target": None,
        "workspace": None,
        "open_browser": False,
    }
    assert "Scout setup" in result.output
    assert "Using LM Studio with qwen3:latest" in result.output
    assert "Saved local model settings" in result.output
    assert 'provider = "lmstudio"' in config_path.read_text(encoding="utf-8")


def test_setup_skips_login_when_already_signed_in(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    login_called = False

    async def login(**_kwargs: object) -> None:
        nonlocal login_called
        login_called = True

    monkeypatch.setattr(
        cli_module,
        "load_session",
        lambda: ScoutSession(
            atlas_url="https://atlas.example",
            access_token="token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="willie@example.org",
            worker_name="Willies Mac",
            default_upload_target="public",
            workspace_id=None,
        ),
    )
    monkeypatch.setattr(cli_module, "_login", login)
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: _resolution())

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup"])

    assert result.exit_code == 0, result.output
    assert login_called is False
    assert "Signed in as willie@example.org" in result.output


def test_setup_llm_explains_when_no_provider_is_ready(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: _resolution(ready=False),
    )

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup", "llm"])

    assert result.exit_code != 0
    assert "No local model is ready" in result.output
    assert "Start Ollama or LM Studio" in result.output
    assert not config_path.exists()


def test_run_auto_resolves_local_model_before_pipeline(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config = ScoutConfig()
    config.store.path = str(tmp_path / "scout.db")
    captured: dict[str, object] = {}

    async def fake_pipeline(*, config: ScoutConfig, **_kwargs: object) -> None:
        captured["provider"] = config.llm.provider
        captured["model"] = config.llm.model

    monkeypatch.setattr(cli_module, "load_config", lambda _path: config)
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: _resolution())

    result = CliRunner().invoke(
        main, ["--config", str(tmp_path / "scout.toml"), "run", "--quiet", "https://example.org"]
    )

    assert result.exit_code == 0, result.output
    assert captured == {"provider": "lmstudio", "model": "qwen3:latest"}


def test_run_explains_missing_local_model_before_pipeline(
    tmp_path: Path,
    monkeypatch,
) -> None:
    called = False

    async def fake_pipeline(**_kwargs: object) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: _resolution(ready=False),
    )

    result = CliRunner().invoke(
        main, ["--config", str(tmp_path / "scout.toml"), "run", "--quiet", "https://example.org"]
    )

    assert result.exit_code != 0
    assert "No local model is ready" in result.output
    assert not called
