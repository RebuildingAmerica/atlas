"""Scout setup shell integration tests."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
from atlas_scout.manpages import ManPageInstallResult
from atlas_scout.shell_integration import CompletionInstallResult


@dataclass(frozen=True, slots=True)
class InstalledShellIntegration:
    """Shell integration call captured from setup."""

    command_name: str
    shell: str
    completion_dir: Path | None
    man_dir: Path | None


def test_setup_help_exposes_install_flags_without_man_command() -> None:
    setup_help = CliRunner().invoke(main, ["setup", "--help"])
    root_help = CliRunner().invoke(main, ["--help"])

    assert setup_help.exit_code == 0, setup_help.output
    assert "--install-completion" in setup_help.output
    assert "--install-man" in setup_help.output
    assert root_help.exit_code == 0, root_help.output
    assert " man " not in f" {root_help.output} "


def test_setup_installs_requested_shell_artifacts(tmp_path, monkeypatch) -> None:
    calls: list[InstalledShellIntegration] = []

    def install_completion(**kwargs: object) -> CompletionInstallResult:
        command_name = str(kwargs["command_name"])
        shell = str(kwargs["shell"])
        completion_dir = kwargs["completion_dir"]
        calls.append(
            InstalledShellIntegration(
                command_name=command_name,
                shell=shell,
                completion_dir=Path(completion_dir) if completion_dir is not None else None,
                man_dir=None,
            )
        )
        return CompletionInstallResult(
            shell=shell,
            command_name=command_name,
            path=tmp_path / "completion",
            rc_path=None,
            rc_block=None,
            activation_note="Completion will load in a new shell.",
        )

    def install_man(**kwargs: object) -> ManPageInstallResult:
        command_name = str(kwargs["command_name"])
        man_dir = kwargs["man_dir"]
        calls.append(
            InstalledShellIntegration(
                command_name=command_name,
                shell="",
                completion_dir=None,
                man_dir=Path(man_dir) if man_dir is not None else None,
            )
        )
        return ManPageInstallResult(
            command_name=command_name,
            man_dir=tmp_path / "man1",
            files=(tmp_path / "man1" / f"{command_name}.1",),
        )

    monkeypatch.setenv("ATLAS_SCOUT_COMMAND_NAME", "scout-dev")
    monkeypatch.setattr(cli_module, "load_session", lambda: _session())
    monkeypatch.setattr(cli_module, "_setup_local_model_provider", lambda _config: _ready_resolution())
    monkeypatch.setattr(cli_module, "_install_completion_for_setup", install_completion)
    monkeypatch.setattr(cli_module, "_install_man_pages_for_setup", install_man)

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(tmp_path / "scout.toml"),
            "setup",
            "--install-completion",
            "--completion-shell",
            "zsh",
            "--completion-dir",
            str(tmp_path / "completions"),
            "--install-man",
            "--man-dir",
            str(tmp_path / "man1"),
        ],
    )

    assert result.exit_code == 0, result.output
    assert calls == [
        InstalledShellIntegration(
            command_name="scout-dev",
            shell="zsh",
            completion_dir=tmp_path / "completions",
            man_dir=None,
        ),
        InstalledShellIntegration(
            command_name="scout-dev",
            shell="",
            completion_dir=None,
            man_dir=tmp_path / "man1",
        ),
    ]
    assert "Installed zsh completion" in result.output
    assert "Installed 1 man page" in result.output


def _session() -> ScoutSession:
    return ScoutSession(
        atlas_url="https://atlas.example",
        access_token="token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="willie@example.org",
        worker_name="Willies Mac",
        default_upload_target="public",
        workspace_id=None,
    )


def _ready_resolution():
    from atlas_scout.local_models import LocalModelResolution

    return LocalModelResolution(
        ready=True,
        provider="lmstudio",
        model="qwen3:latest",
        base_url="http://localhost:1234/v1",
        message="Using LM Studio with qwen3:latest.",
        changed=True,
    )
