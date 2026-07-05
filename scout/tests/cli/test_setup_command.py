"""Scout setup onboarding command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
from atlas_scout.local_models import LocalModelChoice, LocalModelResolution
from atlas_scout.local_provider_bootstrap import LocalProviderInstallPlan

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


def _resolution(*, ready: bool = True) -> LocalModelResolution:
    return LocalModelResolution(
        ready=ready,
        provider="lmstudio" if ready else None,
        model="qwen3:latest" if ready else None,
        base_url="http://localhost:1234/v1" if ready else None,
        message="Using LM Studio with qwen3:latest." if ready else "No local model is ready.",
        remediation=None if ready else "Start Ollama or LM Studio, then run `scout config model`.",
        changed=ready,
    )


def _ollama_resolution() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="deepseek-r1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with deepseek-r1:8b.",
        changed=True,
        choices=(
            LocalModelChoice(
                provider="ollama",
                model="deepseek-r1:8b",
                base_url="http://localhost:11434",
            ),
        ),
    )


def _multi_model_resolution() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="deepseek-r1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with deepseek-r1:8b.",
        changed=True,
        choices=(
            LocalModelChoice(
                provider="ollama",
                model="deepseek-r1:8b",
                base_url="http://localhost:11434",
            ),
            LocalModelChoice(
                provider="ollama",
                model="llama3.2:latest",
                base_url="http://localhost:11434",
            ),
        ),
    )


def _cross_provider_resolution() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="deepseek-r1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with deepseek-r1:8b.",
        changed=True,
        choices=(
            LocalModelChoice(
                provider="ollama",
                model="deepseek-r1:8b",
                base_url="http://localhost:11434",
            ),
            LocalModelChoice(
                provider="lmstudio",
                model="qwen3:latest",
                base_url="http://localhost:1234/v1",
            ),
        ),
    )


def _record_started_provider(started_providers: list[str]) -> Callable[[str], bool]:
    def start(provider: str) -> bool:
        started_providers.append(provider)
        return True

    return start


def test_setup_help_has_no_subcommands() -> None:
    result = CliRunner().invoke(main, ["setup", "--help"])

    assert result.exit_code == 0, result.output
    assert "Commands:" not in result.output
    assert "llm" not in result.output


def test_setup_can_create_new_profile_before_onboarding(
    tmp_path: Path,
    monkeypatch,
) -> None:
    configs_dir = tmp_path / "configs"
    activated: list[str] = []

    async def login(**_kwargs: object) -> None:
        return None

    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", configs_dir)
    monkeypatch.setattr(
        cli_module,
        "get_active_config_path",
        lambda: configs_dir / "default.toml",
    )
    monkeypatch.setattr(cli_module, "set_active_profile_name", activated.append)
    monkeypatch.setattr(
        cli_module,
        "_select_setup_profile_with_arrows",
        lambda *_args, **_kwargs: cli_module.SetupProfileChoice(action="create", name=None),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "load_session", lambda: None)
    monkeypatch.setattr(cli_module, "_login", login)
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("lmstudio",),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: _resolution())

    result = CliRunner().invoke(
        main,
        ["setup", "--no-browser"],
        input="studio\n",
    )

    assert result.exit_code == 0, result.output
    assert activated == ["studio"]
    assert (configs_dir / "studio.toml").exists()
    assert 'provider = "lmstudio"' in (configs_dir / "studio.toml").read_text(encoding="utf-8")


def test_setup_can_continue_existing_profile_before_onboarding(
    tmp_path: Path,
    monkeypatch,
) -> None:
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    existing_path = configs_dir / "studio.toml"
    existing_path.write_text('[llm]\nmodel = "existing-model"\n', encoding="utf-8")

    monkeypatch.setattr(cli_module, "SCOUT_CONFIGS_DIR", configs_dir)
    monkeypatch.setattr(
        cli_module,
        "get_active_config_path",
        lambda: configs_dir / "default.toml",
    )
    monkeypatch.setattr(
        cli_module,
        "_select_setup_profile_with_arrows",
        lambda *_args, **_kwargs: cli_module.SetupProfileChoice(
            action="continue",
            name="studio",
        ),
        raising=False,
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
        lambda: ("lmstudio",),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: _resolution())

    result = CliRunner().invoke(
        main,
        ["setup"],
    )

    assert result.exit_code == 0, result.output
    assert 'model = "qwen3:latest"' in existing_path.read_text(encoding="utf-8")


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
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("lmstudio",),
        raising=False,
    )
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
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("lmstudio",),
        raising=False,
    )
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
        cli_module, "resolve_local_model", lambda *_args, **_kwargs: _ollama_resolution()
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama",),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "_try_start_local_model_server",
        _record_started_provider(started_providers),
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
        cli_module, "resolve_local_model", lambda *_args, **_kwargs: _cross_provider_resolution()
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
        _record_started_provider(started_providers),
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
        _record_started_provider(started_providers),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: _cross_provider_resolution(),
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
        cli_module, "resolve_local_model", lambda *_args, **_kwargs: _cross_provider_resolution()
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
        _record_started_provider(started_providers),
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
        _record_started_provider(started_providers),
        raising=False,
    )
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: _cross_provider_resolution(),
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
        lambda *_args, **_kwargs: _multi_model_resolution(),
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama",),
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
            choices=_multi_model_resolution().choices,
        ),
    )
    monkeypatch.setattr(
        cli_module,
        "_installed_local_model_providers",
        lambda: ("ollama",),
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
