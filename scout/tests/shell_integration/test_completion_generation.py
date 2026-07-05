"""Shell completion generation tests for Scout."""

from __future__ import annotations

from atlas_scout.cli import main
from atlas_scout.shell_integration import (
    build_completion_install_plan,
    complete_var_for_command,
)


def test_complete_var_for_command_matches_click_convention() -> None:
    assert complete_var_for_command("scout") == "_SCOUT_COMPLETE"
    assert complete_var_for_command("scout-dev") == "_SCOUT_DEV_COMPLETE"


def test_completion_plan_uses_selected_command_name(tmp_path) -> None:
    plan = build_completion_install_plan(
        main,
        command_name="scout-dev",
        shell="zsh",
        completion_dir=tmp_path,
    )

    assert plan.path == tmp_path / "_scout-dev"
    assert "#compdef scout-dev" in plan.script
    assert "_SCOUT_DEV_COMPLETE=zsh_complete scout-dev" in plan.script
    assert "_SCOUT_COMPLETE" not in plan.script
