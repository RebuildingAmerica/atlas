"""Scout profile configuration commands."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import click
from rich.table import Table

from atlas_scout.cli_common import _config_mutation_cli_error, _exit_with_error
from atlas_scout.cli_context import console
from atlas_scout.cli_errors import CliError
from atlas_scout.config import (
    SCOUT_CONFIGS_DIR,
    ConfigMutationError,
    ScheduleTarget,
    ScoutConfig,
    add_schedule_target,
    clear_schedule_targets,
    get_active_profile_name,
    get_scalar_config_value,
    remove_schedule_target,
    scalar_config_rows,
    set_active_profile_name,
    set_scalar_config_value,
    update_schedule_settings,
)
from atlas_scout.local_model_commands import (
    _apply_and_persist_local_model,
    _choose_local_model_interactively,
)
from atlas_scout.local_models import (
    LOCAL_PROVIDER_NAMES,
    resolve_local_model,
)

if TYPE_CHECKING:
    from pathlib import Path

_PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")

# ---------------------------------------------------------------------------
# config commands
# ---------------------------------------------------------------------------


@click.group("config")
def config_group() -> None:
    """View and update Scout configuration."""


@config_group.command("profiles")
def config_profiles() -> None:
    """List available configuration profiles."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    profiles = sorted(SCOUT_CONFIGS_DIR.glob("*.toml"))
    if not profiles:
        console.print(f"No profiles found in {SCOUT_CONFIGS_DIR}")
        return
    active = get_active_profile_name()
    for p in profiles:
        marker = " [green](active)[/]" if p.stem == active else ""
        console.print(f"  {p.stem}{marker}")
    console.print("\n[dim]Use 'scout config use-profile <name>' to set the active profile.[/]")


@config_group.command("use-profile")
@click.argument("name")
def config_use_profile(name: str) -> None:
    """Set a profile as the active default (e.g. scout config use-profile studio)."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    source = SCOUT_CONFIGS_DIR / f"{name}.toml"
    if not source.exists():
        available = sorted(p.stem for p in SCOUT_CONFIGS_DIR.glob("*.toml"))
        _exit_with_error(
            CliError(
                title="Profile not found",
                message=f"profile '{name}' not found.",
                hint=f"Available profiles: {', '.join(available)}" if available else None,
            )
        )
    set_active_profile_name(name)
    console.print(f"[green]Active profile set to '{name}'.[/]")


@config_group.command("create-profile")
@click.argument("name")
def config_create_profile(name: str) -> None:
    """Create and activate a new configuration profile."""
    try:
        profile_name = _validate_profile_name(name)
        _create_profile_file(profile_name)
    except click.ClickException as exc:
        _exit_with_error(CliError(title=exc.message, message=f"profile: {name}"))

    set_active_profile_name(profile_name)
    console.print(f"[green]Created profile[/] [bold]{profile_name}[/]")


def _validate_profile_name(name: str) -> str:
    """Return a safe profile name or raise a user-facing error."""
    normalized = name.strip()
    if not _PROFILE_NAME_PATTERN.fullmatch(normalized):
        raise click.ClickException("Invalid profile name")
    return normalized


def _profile_config_path(name: str) -> Path:
    """Return the config path for a validated profile name."""
    return SCOUT_CONFIGS_DIR / f"{name}.toml"


def _create_profile_file(name: str) -> Path:
    """Create an empty profile config file."""
    path = _profile_config_path(name)
    if path.exists():
        raise click.ClickException("Profile already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    return path


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    """Print the current configuration."""
    config: ScoutConfig = ctx.obj["config"]
    table = Table(title="Scout profile configuration", show_lines=False, pad_edge=False)
    table.add_column("Setting", style="bold")
    table.add_column("Value")
    for row in scalar_config_rows(config):
        table.add_row(row.key, _format_config_value(row.value))
    console.print(table)
    loaded_path: Path = ctx.obj["config_path"]
    console.print(f"\n[dim]Profile: {loaded_path.stem} ({loaded_path})[/]")


@config_group.command("path")
@click.pass_context
def config_path(ctx: click.Context) -> None:
    """Print the active profile config path."""
    loaded_path: Path = ctx.obj["config_path"]
    click.echo(str(loaded_path))


@config_group.command("set")
@click.argument("key")
@click.argument("value")
@click.pass_context
def config_set(ctx: click.Context, key: str, value: str) -> None:
    """Set a known scalar profile value persistently."""
    try:
        typed_value = set_scalar_config_value(ctx.obj["config_path"], key, value)
    except ConfigMutationError as exc:
        _exit_with_error(_config_mutation_cli_error(exc))
    console.print(f"[green]Set[/] {key} = [bold]{_format_config_value(typed_value)}[/]")


@config_group.command("get")
@click.argument("key")
@click.pass_context
def config_get(ctx: click.Context, key: str) -> None:
    """Get a single configuration value."""
    config: ScoutConfig = ctx.obj["config"]
    try:
        value = get_scalar_config_value(config, key)
    except ConfigMutationError as exc:
        _exit_with_error(_config_mutation_cli_error(exc))
    console.print(_format_config_value(value))


@config_group.command("model")
@click.option("--provider", type=click.Choice(list(LOCAL_PROVIDER_NAMES)), default=None)
@click.option("--model", "model_name", default=None, help="Local model name to use.")
@click.option("--base-url", default=None, help="Endpoint URL for the selected provider.")
@click.option("--ollama-url", default=None, help="Ollama endpoint URL.")
@click.option("--lmstudio-url", default=None, help="LM Studio endpoint URL.")
@click.option("--interactive", is_flag=True, help="Choose from detected local models.")
@click.pass_context
def config_model(
    ctx: click.Context,
    provider: str | None,
    model_name: str | None,
    base_url: str | None,
    ollama_url: str | None,
    lmstudio_url: str | None,
    interactive: bool,
) -> None:
    """Detect and save the local model Scout should use."""
    config: ScoutConfig = ctx.obj["config"]
    if provider is not None:
        config.llm.provider = provider
    if model_name is not None:
        config.llm.model = model_name
    if ollama_url is not None:
        config.llm.set_configured_base_url("ollama", ollama_url)
    if lmstudio_url is not None:
        config.llm.set_configured_base_url("lmstudio", lmstudio_url)
    if base_url is not None:
        config.llm.set_configured_base_url(config.llm.provider, base_url)

    try:
        resolution = resolve_local_model(config)
        if interactive:
            resolution = _choose_local_model_interactively(config, resolution)
        if not resolution.ready:
            _exit_with_error(
                CliError(
                    title="Local model unavailable",
                    message=resolution.message,
                    hint=resolution.remediation,
                )
            )
        _apply_and_persist_local_model(ctx.obj["config_path"], config, resolution)
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Local model unavailable", message=exc.message))


@config_group.group("schedule")
def config_schedule() -> None:
    """View and update scheduled discovery config."""


@config_schedule.command("show")
@click.pass_context
def config_schedule_show(ctx: click.Context) -> None:
    """Show configured schedule settings and targets."""
    config: ScoutConfig = ctx.obj["config"]
    table = Table(title="Scout schedule", show_lines=False, pad_edge=False)
    table.add_column("Setting", style="bold")
    table.add_column("Value")
    table.add_row("enabled", _format_config_value(config.schedule.enabled))
    table.add_row("cron", config.schedule.cron)
    table.add_row("max_concurrent_runs", str(config.schedule.max_concurrent_runs))
    console.print(table)
    _print_schedule_targets(config.schedule.targets)


@config_schedule.command("set")
@click.option("--enabled/--disabled", "enabled", default=None, help="Enable or disable schedule.")
@click.option("--cron", default=None, help="Cron expression for scheduled runs.")
@click.option(
    "--max-concurrent-runs",
    type=click.IntRange(1),
    default=None,
    help="Maximum scheduled runs that may execute concurrently.",
)
@click.pass_context
def config_schedule_set(
    ctx: click.Context,
    enabled: bool | None,
    cron: str | None,
    max_concurrent_runs: int | None,
) -> None:
    """Set scalar scheduled discovery settings."""
    if enabled is None and cron is None and max_concurrent_runs is None:
        _exit_with_error(
            CliError(
                title="No schedule settings provided",
                message="Pass --enabled, --disabled, --cron, or --max-concurrent-runs.",
            )
        )
    try:
        schedule_config = update_schedule_settings(
            ctx.obj["config_path"],
            enabled=enabled,
            cron=cron,
            max_concurrent_runs=max_concurrent_runs,
        )
    except ConfigMutationError as exc:
        _exit_with_error(_config_mutation_cli_error(exc))
    console.print("[green]Updated schedule config.[/]")
    console.print(f"  Enabled: {_format_config_value(schedule_config.enabled)}")
    console.print(f"  Cron: {schedule_config.cron}")
    console.print(f"  Max concurrent runs: {schedule_config.max_concurrent_runs}")


@config_schedule.group("target")
def config_schedule_target() -> None:
    """Manage scheduled discovery targets."""


@config_schedule_target.command("add")
@click.option("--location", required=True, help="Location to discover.")
@click.option("--issues", required=True, help="Comma-separated issue slugs.")
@click.option(
    "--depth",
    type=click.Choice(["standard", "deep"]),
    default="standard",
    show_default=True,
    help="Search depth.",
)
@click.pass_context
def config_schedule_target_add(
    ctx: click.Context,
    location: str,
    issues: str,
    depth: str,
) -> None:
    """Add a scheduled discovery target."""
    issue_list = _parse_config_issue_list(issues)
    if not issue_list:
        _exit_with_error(
            CliError(title="Missing issues", message="Pass at least one issue slug with --issues.")
        )
    target = ScheduleTarget(location=location, issues=issue_list, search_depth=depth)
    try:
        add_schedule_target(ctx.obj["config_path"], target)
    except ConfigMutationError as exc:
        _exit_with_error(_config_mutation_cli_error(exc))
    console.print(f"[green]Added schedule target.[/] {location}")


@config_schedule_target.command("list")
@click.pass_context
def config_schedule_target_list(ctx: click.Context) -> None:
    """List scheduled discovery targets."""
    config: ScoutConfig = ctx.obj["config"]
    _print_schedule_targets(config.schedule.targets)


@config_schedule_target.command("remove")
@click.argument("index", type=click.IntRange(1))
@click.pass_context
def config_schedule_target_remove(ctx: click.Context, index: int) -> None:
    """Remove a scheduled discovery target by its list index."""
    try:
        removed = remove_schedule_target(ctx.obj["config_path"], index - 1)
    except ConfigMutationError as exc:
        _exit_with_error(_config_mutation_cli_error(exc))
    console.print(f"[green]Removed schedule target.[/] {removed.location}")


@config_schedule_target.command("clear")
@click.pass_context
def config_schedule_target_clear(ctx: click.Context) -> None:
    """Remove all scheduled discovery targets."""
    try:
        removed_count = clear_schedule_targets(ctx.obj["config_path"])
    except ConfigMutationError as exc:
        _exit_with_error(_config_mutation_cli_error(exc))
    console.print(f"[green]Cleared {removed_count} schedule targets.[/]")


def _print_schedule_targets(targets: list[ScheduleTarget]) -> None:
    """Print configured schedule targets."""
    if not targets:
        console.print("[yellow]No schedule targets configured.[/]")
        return
    table = Table(title="Schedule targets", show_lines=False, pad_edge=False)
    table.add_column("#", justify="right")
    table.add_column("Location")
    table.add_column("Issues")
    table.add_column("Depth")
    for index, target in enumerate(targets, start=1):
        table.add_row(
            str(index),
            target.location,
            ", ".join(target.issues),
            target.search_depth,
        )
    console.print(table)


def _parse_config_issue_list(issues: str) -> list[str]:
    """Parse comma-separated issue slugs from config commands."""
    return [issue.strip() for issue in issues.split(",") if issue.strip()]


def _format_config_value(value: str | int | float | bool | None) -> str:
    """Format one profile config value for CLI output."""
    if value is None or value == "":
        return "[dim]not set[/]"
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)
