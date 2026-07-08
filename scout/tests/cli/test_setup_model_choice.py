"""Model choice tests for atlas_scout.cli setup."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
from atlas_scout.local_models import LocalModelResolution

from .setup_support import multi_model_resolution

if TYPE_CHECKING:
    from pathlib import Path


def test_setup_prompts_when_auto_detected_models_require_judgement(
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
        lambda *_args, **_kwargs: multi_model_resolution(),
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama",),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "setup"],
        input="2\n",
    )

    assert result.exit_code == 0, result.output
    assert "Local models" in result.output
    assert "Choose a model" in result.output
    assert "Using Ollama with llama3.2:latest" in result.output
    assert 'model = "llama3.2:latest"' in config_path.read_text(encoding="utf-8")


def test_setup_still_allows_model_choice_when_current_model_is_ready(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    config_path.write_text(
        '[llm]\nprovider = "ollama"\nmodel = "deepseek-r1:8b"\n',
        encoding="utf-8",
    )

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
        lambda *_args, **_kwargs: LocalModelResolution(
            ready=True,
            provider="ollama",
            model="deepseek-r1:8b",
            base_url="http://localhost:11434",
            message="Using Ollama with deepseek-r1:8b.",
            changed=False,
            choices=multi_model_resolution().choices,
        ),
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama",),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "setup"],
        input="2\n",
    )

    assert result.exit_code == 0, result.output
    assert "Local models" in result.output
    assert "Choose a model" in result.output
    assert "Using Ollama with llama3.2:latest" in result.output
    assert 'model = "llama3.2:latest"' in config_path.read_text(encoding="utf-8")
