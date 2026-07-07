"""Scout setup command."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import click

from atlas_scout.auth import load_session
from atlas_scout.auth_commands import _login
from atlas_scout.cli_common import _credential_store_cli_error, _exit_with_error, _run_async
from atlas_scout.cli_context import console, err_console
from atlas_scout.cli_errors import CliError
from atlas_scout.cli_output import print_local_model_setup_help
from atlas_scout.cli_select import InteractiveChoice, SelectionCancelledError, select_with_arrows
from atlas_scout.config import (
    SCOUT_CONFIGS_DIR,
    ScoutConfig,
    get_active_profile_name,
    load_config,
    set_active_profile_name,
)
from atlas_scout.config_commands import (
    _create_profile_file,
    _profile_config_path,
    _validate_profile_name,
)
from atlas_scout.credentials import CredentialStoreError
from atlas_scout.local_model_commands import (
    _choose_local_model_interactively,
    _print_local_model_resolution,
    _save_local_model_config,
    _setup_local_model_provider,
    _should_prompt_for_setup_model_choice,
)
from atlas_scout.local_models import apply_local_model_resolution
from atlas_scout.manpages import ManPageInstallResult, install_man_pages
from atlas_scout.shell_integration import (
    CompletionInstallResult,
    CompletionShellOption,
    ShellIntegrationError,
    ShellName,
    append_managed_rc_block,
    command_name_from_environment,
    detect_shell,
    install_completion_script,
)


@dataclass(frozen=True, slots=True)
class SetupProfileChoice:
    """Profile action selected during Scout setup."""

    action: Literal["continue", "create"]
    name: str | None


# ---------------------------------------------------------------------------
# setup commands
# ---------------------------------------------------------------------------


@click.command("setup")
@click.option("--atlas-url", default=None, help="Atlas app URL for browser login.")
@click.option("--no-browser", "open_browser", flag_value=False, default=True)
@click.option(
    "--install-completion",
    is_flag=True,
    help="Install shell autocomplete for scout or scout-dev.",
)
@click.option("--install-man", is_flag=True, help="Install standard man pages.")
@click.option(
    "--completion-shell",
    type=click.Choice(["auto", "bash", "zsh", "fish"]),
    default="auto",
    show_default=True,
    help="Shell to install autocomplete for.",
)
@click.option(
    "--completion-dir",
    type=click.Path(file_okay=False, dir_okay=True, path_type=Path),
    default=None,
    help="Completion install directory.",
)
@click.option(
    "--man-dir",
    type=click.Path(file_okay=False, dir_okay=True, path_type=Path),
    default=None,
    help="Man page install directory.",
)
@click.pass_context
def setup_command(
    ctx: click.Context,
    atlas_url: str | None,
    open_browser: bool,
    install_completion: bool,
    install_man: bool,
    completion_shell: CompletionShellOption,
    completion_dir: Path | None,
    man_dir: Path | None,
) -> None:
    """Set up Scout on this computer."""
    _run_async(
        _setup_onboarding(
            config=ctx.obj["config"],
            config_path=ctx.obj["config_path"],
            explicit_config_path=ctx.obj["explicit_config_path"],
            requested_profile_name=ctx.obj["requested_profile_name"],
            atlas_url=atlas_url,
            open_browser=open_browser,
            install_completion=install_completion,
            install_man=install_man,
            completion_shell=completion_shell,
            completion_dir=completion_dir,
            man_dir=man_dir,
        )
    )


async def _setup_onboarding(
    *,
    config: ScoutConfig,
    config_path: Path,
    explicit_config_path: str | None,
    requested_profile_name: str | None,
    atlas_url: str | None,
    open_browser: bool,
    install_completion: bool,
    install_man: bool,
    completion_shell: CompletionShellOption,
    completion_dir: Path | None,
    man_dir: Path | None,
) -> None:
    """Run Scout's low-decision onboarding flow."""
    console.print("[bold]Scout setup[/]")
    console.print()

    config, config_path = _select_setup_profile(
        config,
        config_path,
        explicit_config_path=explicit_config_path,
        requested_profile_name=requested_profile_name,
    )

    try:
        session = load_session()
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))

    if session is None:
        await _login(
            atlas_url=atlas_url,
            target=None,
            workspace=None,
            open_browser=open_browser,
        )
    else:
        console.print(f"Signed in as [bold]{session.user_email}[/]")

    _install_requested_shell_integrations(
        install_completion=install_completion,
        install_man=install_man,
        completion_shell=completion_shell,
        completion_dir=completion_dir,
        man_dir=man_dir,
    )

    resolution = _setup_local_model_provider(config)
    if not resolution.ready:
        print_local_model_setup_help(console, resolution, default_model=config.llm.model)
        return

    if _should_prompt_for_setup_model_choice(resolution):
        resolution = _choose_local_model_interactively(config, resolution)

    apply_local_model_resolution(config, resolution)
    _save_local_model_config(config_path, config, resolution)

    _print_local_model_resolution(resolution, saved=bool(resolution))
    console.print()
    console.print("[green]Scout setup complete.[/]")
    console.print("[dim]Run `scout doctor` to check this computer before discovery work.[/]")


def _install_requested_shell_integrations(
    *,
    install_completion: bool,
    install_man: bool,
    completion_shell: CompletionShellOption,
    completion_dir: Path | None,
    man_dir: Path | None,
) -> None:
    """Install requested shell artifacts during setup."""
    if not install_completion and not install_man:
        return

    command_name = command_name_from_environment()
    if install_completion:
        try:
            shell = _resolve_completion_shell(completion_shell)
            completion_result = _install_completion_for_setup(
                command_name=command_name,
                shell=shell,
                completion_dir=completion_dir,
            )
        except ShellIntegrationError as exc:
            _exit_with_error(CliError(title="Completion setup failed", message=str(exc)))
        _print_completion_install_result(completion_result)

    if install_man:
        man_result = _install_man_pages_for_setup(command_name=command_name, man_dir=man_dir)
        _print_man_page_install_result(man_result)


def _resolve_completion_shell(completion_shell: CompletionShellOption) -> ShellName:
    """Resolve auto shell selection to a concrete supported shell."""
    if completion_shell != "auto":
        return completion_shell
    return detect_shell()


def _install_completion_for_setup(
    *,
    command_name: str,
    shell: ShellName,
    completion_dir: Path | None,
) -> CompletionInstallResult:
    """Install shell completion for setup."""
    from atlas_scout.cli import main

    return install_completion_script(
        main,
        command_name=command_name,
        shell=shell,
        completion_dir=completion_dir,
    )


def _install_man_pages_for_setup(
    *,
    command_name: str,
    man_dir: Path | None,
) -> ManPageInstallResult:
    """Install man pages for setup."""
    from atlas_scout.cli import main

    return install_man_pages(main, command_name=command_name, man_dir=man_dir)


def _print_completion_install_result(result: CompletionInstallResult) -> None:
    """Print completion install result and optional shell startup action."""
    console.print(f"[green]Installed {result.shell} completion[/] {result.path}")
    if result.rc_path is None or result.rc_block is None:
        console.print(f"[dim]{result.activation_note}[/]")
        return

    if sys.stdin.isatty() and click.confirm(
        f"Update {result.rc_path} so {result.command_name} completion loads automatically?",
        default=False,
    ):
        changed = append_managed_rc_block(
            result.rc_path,
            name=f"{result.command_name} completion",
            block=result.rc_block,
        )
        if changed:
            console.print(f"[green]Updated[/] {result.rc_path}")
        else:
            console.print(f"[dim]{result.rc_path} already has the Scout completion block.[/]")
        return

    console.print(f"[dim]{result.activation_note}[/]")
    console.print(f"[dim]To load it automatically, add this to {result.rc_path}:[/]")
    console.print(result.rc_block)


def _print_man_page_install_result(result: ManPageInstallResult) -> None:
    """Print man page install result."""
    count = len(result.files)
    label = "man page" if count == 1 else "man pages"
    console.print(f"[green]Installed {count} {label}[/] {result.man_dir}")


def _select_setup_profile(
    config: ScoutConfig,
    config_path: Path,
    *,
    explicit_config_path: str | None,
    requested_profile_name: str | None,
) -> tuple[ScoutConfig, Path]:
    """Let interactive setup continue an existing profile or create a new one."""
    if explicit_config_path is not None or requested_profile_name is not None:
        return config, config_path

    choice = _select_setup_profile_with_arrows(config_path)
    if choice is None:
        return config, config_path

    if choice.action == "continue":
        if choice.name is None:
            return config, config_path
        selected_path = _profile_config_path(choice.name)
        set_active_profile_name(choice.name)
        return load_config(selected_path), selected_path

    profile_name = _prompt_for_new_profile_name()
    selected_path = _create_profile_file(profile_name)
    set_active_profile_name(profile_name)
    console.print(f"[green]Created profile[/] [bold]{profile_name}[/]")
    console.print()
    return load_config(selected_path), selected_path


def _select_setup_profile_with_arrows(config_path: Path) -> SetupProfileChoice | None:
    """Use an arrow-key picker for setup profile selection when a TTY is available."""
    choices = _setup_profile_choices(config_path)
    if not choices:
        return None
    try:
        return select_with_arrows(
            title="Scout profile",
            text="Continue an existing setup or create a separate profile for this computer.",
            choices=choices,
        )
    except SelectionCancelledError as exc:
        raise click.Abort from exc


def _setup_profile_choices(
    config_path: Path,
) -> tuple[InteractiveChoice[SetupProfileChoice], ...]:
    """Return profile choices for setup."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    active_name = get_active_profile_name()
    profiles = sorted(path.stem for path in SCOUT_CONFIGS_DIR.glob("*.toml"))
    if config_path.parent == SCOUT_CONFIGS_DIR and config_path.stem not in profiles:
        profiles.insert(0, config_path.stem)

    choices = [
        InteractiveChoice(
            value=SetupProfileChoice(action="continue", name=name),
            label=f"Continue {name}",
            detail="active" if name == active_name else "profile",
        )
        for name in profiles
    ]
    choices.append(
        InteractiveChoice(
            value=SetupProfileChoice(action="create", name=None),
            label="Create new profile",
            detail="separate settings",
        )
    )
    return tuple(choices)


def _prompt_for_new_profile_name() -> str:
    """Prompt until the user enters a valid, unused profile name."""
    while True:
        name = click.prompt("Profile name", type=str)
        try:
            profile_name = _validate_profile_name(name)
            if _profile_config_path(profile_name).exists():
                raise click.ClickException("Profile already exists")
            return profile_name
        except click.ClickException as exc:
            err_console.print(f"[red]{exc.message}:[/] {name}")
