"""Provider flow tests for atlas_scout.cli setup."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
from atlas_scout.local_provider_bootstrap import LocalProviderInstallPlan

from .setup_support import (
    cross_provider_resolution,
    ollama_resolution,
    record_started_provider,
    resolution,
)

if TYPE_CHECKING:
    from pathlib import Path


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
        lambda *_args, **_kwargs: resolution(ready=False),
    )
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        lambda *_args, **_kwargs: False,
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: (),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup"])

    assert result.exit_code == 0, result.output
    assert "Local model" in result.output
    assert "Scout needs a local chat model" in result.output
    assert "Install Ollama" in result.output
    assert "ollama pull llama3.1:8b" in result.output
    assert "LM Studio" in result.output
    assert "scout config model" in result.output
    assert "scout config llm" not in result.output
    assert "scout setup llm" not in result.output
    assert not config_path.exists()


def test_setup_starts_local_provider_before_showing_next_steps(
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
    started_providers: list[str] = []

    monkeypatch.setattr(
        cli_module, "resolve_local_model", lambda *_args, **_kwargs: ollama_resolution()
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
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        record_started_provider(started_providers),
        raising=False,
    )

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup"])

    assert result.exit_code == 0, result.output
    assert "Using Ollama with deepseek-r1:8b" in result.output
    assert "Local model not ready" not in result.output
    assert 'provider = "ollama"' in config_path.read_text(encoding="utf-8")
    assert started_providers == ["ollama"]


def test_setup_prompts_for_provider_when_multiple_can_be_started(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    started_providers: list[str] = []

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
        cli_module, "resolve_local_model", lambda *_args, **_kwargs: cross_provider_resolution()
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama", "lmstudio"),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        record_started_provider(started_providers),
        raising=False,
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "setup"],
        input="\n\n",
    )

    assert result.exit_code == 0, result.output
    assert "providers" in result.output
    assert "Choose a provider" in result.output
    assert started_providers == ["lmstudio"]
    assert "Using LM Studio with qwen3:latest" in result.output
    assert 'provider = "lmstudio"' in config_path.read_text(encoding="utf-8")


def test_setup_defaults_to_lmstudio_when_multiple_providers_are_installed(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    started_providers: list[str] = []

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
        "_installed_local_model_providers",
        lambda: ("lmstudio", "ollama"),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        record_started_provider(started_providers),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: cross_provider_resolution(),
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "setup"],
        input="\n\n",
    )

    assert result.exit_code == 0, result.output
    assert started_providers == ["lmstudio"]
    assert "Using LM Studio with qwen3:latest" in result.output


def test_setup_prompts_for_provider_even_when_current_provider_is_ready(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    config_path.write_text(
        '[llm]\nprovider = "ollama"\nmodel = "deepseek-r1:8b"\n',
        encoding="utf-8",
    )
    started_providers: list[str] = []

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
        cli_module, "resolve_local_model", lambda *_args, **_kwargs: cross_provider_resolution()
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama", "lmstudio"),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        record_started_provider(started_providers),
        raising=False,
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "setup"],
        input="\n\n",
    )

    assert result.exit_code == 0, result.output
    assert "Choose a provider" in result.output
    assert started_providers == ["lmstudio"]
    assert "Using LM Studio with qwen3:latest" in result.output
    assert 'provider = "lmstudio"' in config_path.read_text(encoding="utf-8")


def test_setup_offers_install_for_missing_provider_before_model_choice(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "scout.toml"
    installed_plans: list[LocalProviderInstallPlan] = []
    started_providers: list[str] = []

    install_plan = LocalProviderInstallPlan(
        provider="lmstudio",
        label="Install LM Studio with Homebrew",
        command=("brew", "install", "--cask", "lm-studio"),
        url=None,
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
        "_installed_local_model_providers",
        lambda: ("ollama",),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: ("lmstudio",),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_install_plan_for_local_provider",
        lambda _provider: install_plan,
        raising=False,
    )

    def install_provider(plan: LocalProviderInstallPlan) -> bool:
        installed_plans.append(plan)
        return True

    monkeypatch.setattr(
        cli_module,
        "_install_local_model_provider",
        install_provider,
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        record_started_provider(started_providers),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: cross_provider_resolution(),
    )

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "setup"],
        input="\ny\n\n",
    )

    assert result.exit_code == 0, result.output
    assert "Install LM Studio with Homebrew" in result.output
    assert installed_plans == [install_plan]
    assert started_providers == ["lmstudio"]
    assert "Using LM Studio with qwen3:latest" in result.output
