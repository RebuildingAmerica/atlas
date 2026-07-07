"""Root Click application for Atlas Scout."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import click

from atlas_scout.articles_commands import articles
from atlas_scout.auth_commands import auth_group, login, logout, search_group, whoami
from atlas_scout.cli_common import _exit_with_error
from atlas_scout.cli_errors import CliError
from atlas_scout.config import (
    SCOUT_CONFIGS_DIR,
    get_active_config_path,
    get_active_profile_name,
    load_config,
)
from atlas_scout.config_commands import config_group
from atlas_scout.daemon_commands import daemon
from atlas_scout.db_commands import db
from atlas_scout.doctor_commands import doctor
from atlas_scout.entries_commands import entries, export_group
from atlas_scout.pages_commands import pages
from atlas_scout.pipeline_commands import run
from atlas_scout.runs_commands import runs, sync
from atlas_scout.schedule_commands import schedule
from atlas_scout.setup_commands import setup_command
from atlas_scout.worker_commands import worker_group

ROOT_COMMANDS: tuple[click.Command, ...] = (
    articles,
    auth_group,
    config_group,
    daemon,
    db,
    doctor,
    entries,
    export_group,
    login,
    logout,
    pages,
    run,
    runs,
    schedule,
    search_group,
    setup_command,
    sync,
    whoami,
    worker_group,
)


@click.group()
@click.option(
    "--config",
    "config_path",
    type=click.Path(exists=False),
    default=None,
    help="Full path to a config file. Overrides --profile.",
)
@click.option(
    "--profile",
    "profile_name",
    default=None,
    help="Config profile name to load from the configs directory (e.g. 'studio', 'laptop').",
)
@click.option("--debug", is_flag=True, help="Verbose debug logging to stderr.")
@click.pass_context
def main(
    ctx: click.Context, config_path: str | None, profile_name: str | None, debug: bool
) -> None:
    """Atlas Scout — discover people, orgs, and initiatives from the web.

    \b
    Start here:
      scout login
      scout doctor
      scout run https://example.org
      scout sync
    """
    ctx.ensure_object(dict)
    path = _resolve_config_path(config_path=config_path, profile_name=profile_name)
    ctx.obj["config"] = load_config(path)
    ctx.obj["config_path"] = path
    ctx.obj["profile_name"] = _resolved_profile_name(
        explicit_config_path=config_path,
        requested_profile_name=profile_name,
        loaded_path=path,
    )
    ctx.obj["explicit_config_path"] = config_path
    ctx.obj["requested_profile_name"] = profile_name
    ctx.obj["debug"] = debug
    _configure_logging(debug=debug)


def _resolve_config_path(*, config_path: str | None, profile_name: str | None) -> Path:
    """Resolve the config file requested by root CLI options."""
    if config_path:
        return Path(config_path)
    if profile_name:
        path = SCOUT_CONFIGS_DIR / f"{profile_name}.toml"
        if path.exists():
            return path
        available = sorted(p.stem for p in SCOUT_CONFIGS_DIR.glob("*.toml"))
        _exit_with_error(
            CliError(
                title="Profile not found",
                message=f"profile '{profile_name}' not found at {path}",
                hint=f"Available profiles: {', '.join(available)}" if available else None,
            )
        )
    return get_active_config_path()


def _resolved_profile_name(
    *,
    explicit_config_path: str | None,
    requested_profile_name: str | None,
    loaded_path: Path,
) -> str | None:
    """Determine which profile name should be recorded for daemon metadata."""
    if requested_profile_name:
        return requested_profile_name
    if explicit_config_path is None:
        return get_active_profile_name()
    if loaded_path.parent == SCOUT_CONFIGS_DIR:
        return loaded_path.stem
    return None


def _configure_logging(*, debug: bool) -> None:
    """Apply root CLI logging defaults."""
    if not debug:
        logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
        return

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        stream=sys.stderr,
    )
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


for root_command in ROOT_COMMANDS:
    main.add_command(root_command)
