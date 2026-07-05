"""Install shell completion scripts for Scout."""

from __future__ import annotations

import os
import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from click.shell_completion import get_completion_class

if TYPE_CHECKING:
    from collections.abc import Mapping

    import click

ShellName = Literal["bash", "zsh", "fish"]
CompletionShellOption = Literal["auto", "bash", "zsh", "fish"]

SHELL_NAMES: tuple[ShellName, ...] = ("bash", "zsh", "fish")


class ShellIntegrationError(RuntimeError):
    """Raised when shell integration cannot be installed."""


@dataclass(frozen=True, slots=True)
class CompletionInstallPlan:
    """Completion script ready to write to disk."""

    shell: ShellName
    command_name: str
    path: Path
    script: str
    rc_path: Path | None
    rc_block: str | None
    activation_note: str


@dataclass(frozen=True, slots=True)
class CompletionInstallResult:
    """Completion install result."""

    shell: str
    command_name: str
    path: Path
    rc_path: Path | None
    rc_block: str | None
    activation_note: str


def command_name_from_environment(env: Mapping[str, str] | None = None) -> str:
    """Return the command name shell artifacts should target."""
    environ = env if env is not None else os.environ
    configured = environ.get("ATLAS_SCOUT_COMMAND_NAME", "").strip()
    return configured or "scout"


def complete_var_for_command(command_name: str) -> str:
    """Return Click's shell-completion environment variable for a command."""
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", command_name).strip("_").upper()
    if not normalized:
        raise ShellIntegrationError("Command name is required for completion setup.")
    return f"_{normalized}_COMPLETE"


def detect_shell(env: Mapping[str, str] | None = None) -> ShellName:
    """Detect the user's shell from environment variables."""
    environ = env if env is not None else os.environ
    shell_name = Path(environ.get("SHELL", "")).name
    if shell_name in SHELL_NAMES:
        return shell_name
    raise ShellIntegrationError(
        "Could not detect a supported shell. Re-run with "
        "--completion-shell bash, zsh, or fish."
    )


def default_completion_dir(shell: ShellName, env: Mapping[str, str] | None = None) -> Path:
    """Return the standard user-level completion directory for one shell."""
    environ = env if env is not None else os.environ
    home = _home_path(environ)
    xdg_data_home = Path(environ.get("XDG_DATA_HOME", str(home / ".local/share")))

    if shell == "fish":
        xdg_config_home = Path(environ.get("XDG_CONFIG_HOME", str(home / ".config")))
        return xdg_config_home / "fish/completions"

    if shell == "zsh":
        return xdg_data_home / "zsh/site-functions"

    bash_completion_user_dir = environ.get("BASH_COMPLETION_USER_DIR")
    if bash_completion_user_dir:
        return Path(bash_completion_user_dir) / "completions"
    return xdg_data_home / "bash-completion/completions"


def build_completion_install_plan(
    cli: click.Command,
    *,
    command_name: str,
    shell: ShellName,
    completion_dir: Path | str,
) -> CompletionInstallPlan:
    """Build a shell completion install plan without writing files."""
    completion_class = get_completion_class(shell)
    if completion_class is None:
        raise ShellIntegrationError(f"Unsupported shell: {shell}")

    resolved_dir = Path(completion_dir)
    path = resolved_dir / _completion_filename(shell, command_name)
    complete_var = complete_var_for_command(command_name)
    script = completion_class(cli, {}, command_name, complete_var).source()
    rc_path, rc_block, activation_note = _rc_update(shell, resolved_dir, command_name)
    return CompletionInstallPlan(
        shell=shell,
        command_name=command_name,
        path=path,
        script=script,
        rc_path=rc_path,
        rc_block=rc_block,
        activation_note=activation_note,
    )


def install_completion_script(
    cli: click.Command,
    *,
    command_name: str,
    shell: ShellName,
    completion_dir: Path | str | None = None,
    env: Mapping[str, str] | None = None,
) -> CompletionInstallResult:
    """Install a shell completion script for Scout."""
    resolved_dir = Path(completion_dir) if completion_dir is not None else default_completion_dir(
        shell,
        env=env,
    )
    plan = build_completion_install_plan(
        cli,
        command_name=command_name,
        shell=shell,
        completion_dir=resolved_dir,
    )
    plan.path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(plan.path, plan.script)
    return CompletionInstallResult(
        shell=plan.shell,
        command_name=plan.command_name,
        path=plan.path,
        rc_path=plan.rc_path,
        rc_block=plan.rc_block,
        activation_note=plan.activation_note,
    )


def append_managed_rc_block(rc_path: Path, *, name: str, block: str) -> bool:
    """Append a managed startup block if it is not already present."""
    start_marker = f"# >>> atlas {name} >>>"
    end_marker = f"# <<< atlas {name} <<<"
    existing = rc_path.read_text(encoding="utf-8") if rc_path.exists() else ""
    if start_marker in existing:
        return False

    rc_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = "" if not existing or existing.endswith("\n") else "\n"
    managed_block = f"{prefix}{start_marker}\n{block.rstrip()}\n{end_marker}\n"
    with rc_path.open("a", encoding="utf-8") as handle:
        handle.write(managed_block)
    return True


def _completion_filename(shell: ShellName, command_name: str) -> str:
    """Return the conventional completion filename for one shell."""
    if shell == "zsh":
        return f"_{command_name}"
    if shell == "fish":
        return f"{command_name}.fish"
    return command_name


def _rc_update(
    shell: ShellName,
    completion_dir: Path,
    command_name: str,
) -> tuple[Path | None, str | None, str]:
    """Return optional shell startup edits for installed completions."""
    if shell == "fish":
        return (
            None,
            None,
            f"Completion for `{command_name}` will load automatically in a new fish shell.",
        )

    home = Path.home()
    quoted_dir = shlex.quote(str(completion_dir))
    if shell == "zsh":
        return (
            Path(os.environ.get("ZDOTDIR", str(home))) / ".zshrc",
            "\n".join(
                [
                    f"fpath=({quoted_dir} $fpath)",
                    "autoload -Uz compinit",
                    "compinit",
                ]
            ),
            f"Restart zsh, then type `{command_name} <TAB>`.",
        )

    return (
        home / ".bashrc",
        f'for file in {quoted_dir}/*; do [ -r "$file" ] && . "$file"; done',
        f"Restart bash, then type `{command_name} <TAB>`.",
    )


def _home_path(environ: Mapping[str, str]) -> Path:
    """Return HOME or fail explicitly."""
    home = environ.get("HOME", "").strip()
    if not home:
        raise ShellIntegrationError("HOME is required to install shell completion.")
    return Path(home)


def _atomic_write_text(path: Path, text: str) -> None:
    """Write text through a temporary file before replacing the destination."""
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)
