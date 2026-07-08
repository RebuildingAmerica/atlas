"""Setup onboarding tests for atlas_scout.cli."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main

from .setup_support import resolution

if TYPE_CHECKING:
    from pathlib import Path


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
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: resolution())

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
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: resolution())

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
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: resolution())

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
    monkeypatch.setattr(
        cli_module,
        "_missing_local_model_providers",
        lambda: (),
        raising=False,
    )
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_args, **_kwargs: resolution())

    result = CliRunner().invoke(main, ["--config", str(config_path), "setup"])

    assert result.exit_code == 0, result.output
    assert login_called is False
    assert "Signed in as willie@example.org" in result.output
