"""Shell completion install tests for Scout."""

from __future__ import annotations

import pytest

from atlas_scout.cli import main
from atlas_scout.shell_integration import (
    ShellIntegrationError,
    append_managed_rc_block,
    default_completion_dir,
    detect_shell,
    install_completion_script,
)


def test_default_completion_dir_uses_standard_shell_locations(tmp_path) -> None:
    env = {"HOME": str(tmp_path), "XDG_DATA_HOME": str(tmp_path / "xdg")}

    assert default_completion_dir("fish", env=env) == tmp_path / ".config/fish/completions"
    assert default_completion_dir("zsh", env=env) == tmp_path / "xdg/zsh/site-functions"
    assert default_completion_dir("bash", env=env) == tmp_path / "xdg/bash-completion/completions"


def test_default_completion_dir_honors_bash_completion_user_dir(tmp_path) -> None:
    env = {"HOME": str(tmp_path), "BASH_COMPLETION_USER_DIR": str(tmp_path / "bash")}

    assert default_completion_dir("bash", env=env) == tmp_path / "bash/completions"


def test_detect_shell_requires_known_shell() -> None:
    assert detect_shell(env={"SHELL": "/bin/zsh"}) == "zsh"
    assert detect_shell(env={"SHELL": "/opt/homebrew/bin/fish"}) == "fish"

    with pytest.raises(ShellIntegrationError, match="Could not detect a supported shell"):
        detect_shell(env={"SHELL": "/bin/sh"})


def test_install_completion_script_writes_atomically(tmp_path) -> None:
    result = install_completion_script(
        main,
        command_name="scout",
        shell="bash",
        completion_dir=tmp_path,
    )

    assert result.path == tmp_path / "scout"
    assert "_SCOUT_COMPLETE=bash_complete" in result.path.read_text(encoding="utf-8")


def test_append_managed_rc_block_is_idempotent(tmp_path) -> None:
    rc_path = tmp_path / ".zshrc"
    block = "fpath=(/tmp/scout-completions $fpath)"

    append_managed_rc_block(rc_path, name="scout completion", block=block)
    append_managed_rc_block(rc_path, name="scout completion", block=block)

    text = rc_path.read_text(encoding="utf-8")
    assert text.count("# >>> atlas scout completion >>>") == 1
    assert block in text
