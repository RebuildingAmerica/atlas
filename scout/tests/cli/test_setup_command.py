"""Scout setup onboarding command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
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
        remediation=None if ready else "Start Ollama or LM Studio, then run `scout config llm`.",
        changed=ready,
    )


def test_setup_help_has_no_subcommands() -> None:
    result = CliRunner().invoke(main, ["setup", "--help"])

    assert result.exit_code == 0, result.output
    assert "Commands:" not in result.output
    assert "llm" not in result.output


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


def test_setup_offers_local_model_next_steps_when_no_provider_is_ready(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
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
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: _resolution(ready=False),
    )

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup"])

    assert result.exit_code == 0, result.output
    assert "Local model" in result.output
    assert "Scout needs a local chat model" in result.output
    assert "Install Ollama" in result.output
    assert "ollama pull llama3.1:8b" in result.output
    assert "LM Studio" in result.output
    assert "scout config llm" in result.output
    assert "scout setup llm" not in result.output
    assert not config_path.exists()
