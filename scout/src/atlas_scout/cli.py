"""Atlas Scout CLI — discover people, orgs, and initiatives from the web."""

from __future__ import annotations

import asyncio
import contextlib
import csv
import io
import json
import logging
import os
import platform
import random
import re
import signal
import subprocess
import sys
import time
import tomllib
import webbrowser
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal, NoReturn, cast

import click
from rich.table import Table

from atlas_scout import cli_daemon as _daemon_helpers
from atlas_scout.atlas_urls import DEFAULT_ATLAS_URL
from atlas_scout.auth import (
    DeviceAuthClient,
    DeviceAuthError,
    DeviceCode,
    DeviceToken,
    ScoutSession,
    UploadTarget,
    delete_session,
    load_session,
    save_session,
)
from atlas_scout.cli_context import console, err_console
from atlas_scout.cli_errors import CliError
from atlas_scout.cli_output import (
    format_device_auth_error,
    format_verification_uri_complete,
    print_cli_error,
    print_duplicate_run_notice,
    print_local_model_setup_help,
    print_login_instructions,
    print_login_success,
    print_run_banner,
    print_run_results,
    styled_status,
)
from atlas_scout.cli_progress import ProgressRenderer
from atlas_scout.cli_select import InteractiveChoice, SelectionCancelledError, select_with_arrows
from atlas_scout.config import (
    SCOUT_CONFIG_DIR,
    SCOUT_CONFIGS_DIR,
    ConfigMutationError,
    ScheduleTarget,
    ScoutConfig,
    add_schedule_target,
    clear_schedule_targets,
    get_active_config_path,
    get_active_profile_name,
    get_scalar_config_value,
    load_config,
    remove_schedule_target,
    save_local_model_settings,
    scalar_config_rows,
    set_active_profile_name,
    set_scalar_config_value,
    update_schedule_settings,
)
from atlas_scout.credentials import CredentialStoreError
from atlas_scout.doctor import run_doctor
from atlas_scout.doctor_output import print_doctor_report
from atlas_scout.entries_commands import entries_purge_command, entries_stats_command
from atlas_scout.local_models import (
    LOCAL_PROVIDER_NAMES,
    LocalModelChoice,
    LocalModelResolution,
    LocalProviderName,
    apply_local_model_resolution,
    is_local_provider,
    provider_label,
    resolve_local_model,
    select_local_model_choice,
)
from atlas_scout.local_provider_bootstrap import (
    LocalProviderInstallPlan,
    install_local_model_provider,
    install_plan_for_provider,
    installed_local_model_providers,
    missing_local_model_providers,
    start_local_model_server,
)
from atlas_scout.login_flow import (
    LoginExecutionError,
    begin_login,
    complete_login,
)
from atlas_scout.manpages import ManPageInstallResult, install_man_pages
from atlas_scout.pipeline_support import close_if_supported as _close_if_supported
from atlas_scout.runtime import build_runtime_profile
from atlas_scout.search_keys import (
    delete_stored_search_api_key,
    has_search_api_key,
    resolve_search_api_key,
    save_search_api_key,
)
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

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Coroutine
    from typing import Any

    from atlas_shared import SyncedEntryLink

    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.runtime import RuntimeProfile
    from atlas_scout.steps.contribute import ContributionResult

__all__ = [
    "_clear_failed_daemon_start",
    "_daemon_interval_metadata",
    "_daemon_process_is_running",
    "_daemon_run_internal",
    "_daemon_start",
    "_daemon_start_claim_is_stale",
    "_daemon_start_conflict_message",
    "_daemon_status",
    "_daemon_stop",
    "_install_daemon_signal_handlers",
    "_open_store",
    "_render_recent_run_summary",
    "_render_recent_tick_summary",
    "_require_schedule_targets",
    "_signal_daemon_process",
    "_spawn_daemon_process",
    "_wait_for_daemon_start",
    "_wait_for_daemon_stop",
    "main",
]

WORKER_STATE_PATH = SCOUT_CONFIG_DIR / "worker.json"
LOCAL_WORKER_PROVIDERS = frozenset(LOCAL_PROVIDER_NAMES)
_PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_WORKER_STOPPED_STATE: dict[str, object] = {
    "atlas_url": None,
    "current_job_id": None,
    "last_completed_job_id": None,
    "last_error": None,
    "last_heartbeat_at": None,
    "mode": "stopped",
    "process_id": None,
    "search_key_configured": False,
    "started_at": None,
    "status": "stopped",
    "worker_id": None,
    "worker_name": None,
}

_DAEMON_PATCH_TARGETS = (
    "_clear_failed_daemon_start",
    "_daemon_interval_metadata",
    "_daemon_process_is_running",
    "_daemon_run_internal",
    "_daemon_start",
    "_daemon_start_claim_is_stale",
    "_daemon_start_conflict_message",
    "_daemon_status",
    "_daemon_stop",
    "_install_daemon_signal_handlers",
    "_open_store",
    "_render_recent_run_summary",
    "_render_recent_tick_summary",
    "_require_schedule_targets",
    "_signal_daemon_process",
    "_spawn_daemon_process",
    "_wait_for_daemon_start",
    "_wait_for_daemon_stop",
)
_ORIGINAL_CLEAR_FAILED_DAEMON_START = cast(
    "Callable[..., Awaitable[None]]",
    _daemon_helpers._clear_failed_daemon_start,
)
_ORIGINAL_DAEMON_INTERVAL_METADATA = cast(
    "Callable[..., tuple[int, str]]",
    _daemon_helpers._daemon_interval_metadata,
)
_ORIGINAL_DAEMON_PROCESS_IS_RUNNING = cast(
    "Callable[[int], bool]",
    _daemon_helpers._daemon_process_is_running,
)
_ORIGINAL_DAEMON_RUN_INTERNAL = cast(
    "Callable[..., Awaitable[None]]",
    _daemon_helpers._daemon_run_internal,
)
_ORIGINAL_DAEMON_START = cast("Callable[..., Awaitable[None]]", _daemon_helpers._daemon_start)
_ORIGINAL_DAEMON_START_CLAIM_IS_STALE = cast(
    "Callable[..., bool]",
    _daemon_helpers._daemon_start_claim_is_stale,
)
_ORIGINAL_DAEMON_START_CONFLICT_MESSAGE = cast(
    "Callable[[dict[str, object]], str]",
    _daemon_helpers._daemon_start_conflict_message,
)
_ORIGINAL_DAEMON_STATUS = cast(
    "Callable[[ScoutConfig], Awaitable[None]]", _daemon_helpers._daemon_status
)
_ORIGINAL_DAEMON_STOP = cast(
    "Callable[[ScoutConfig], Awaitable[None]]", _daemon_helpers._daemon_stop
)
_ORIGINAL_INSTALL_DAEMON_SIGNAL_HANDLERS = cast(
    "Callable[[asyncio.Event], None]",
    _daemon_helpers._install_daemon_signal_handlers,
)
_ORIGINAL_OPEN_STORE = cast(
    "Callable[[ScoutConfig], Awaitable[object]]", _daemon_helpers._open_store
)
_ORIGINAL_RENDER_RECENT_RUN_SUMMARY = cast(
    "Callable[[dict[str, object] | None], str]",
    _daemon_helpers._render_recent_run_summary,
)
_ORIGINAL_RENDER_RECENT_TICK_SUMMARY = cast(
    "Callable[[dict[str, object]], str]",
    _daemon_helpers._render_recent_tick_summary,
)
_ORIGINAL_REQUIRE_SCHEDULE_TARGETS = cast(
    "Callable[[ScoutConfig], int]",
    _daemon_helpers._require_schedule_targets,
)
_ORIGINAL_SIGNAL_DAEMON_PROCESS = cast(
    "Callable[[int], None]",
    _daemon_helpers._signal_daemon_process,
)
_ORIGINAL_SPAWN_DAEMON_PROCESS = cast(
    "Callable[..., subprocess.Popen[bytes]]",
    _daemon_helpers._spawn_daemon_process,
)
_ORIGINAL_WAIT_FOR_DAEMON_START = cast(
    "Callable[..., Awaitable[dict[str, object]]]",
    _daemon_helpers._wait_for_daemon_start,
)
_ORIGINAL_WAIT_FOR_DAEMON_STOP = cast(
    "Callable[..., Awaitable[dict[str, object]]]",
    _daemon_helpers._wait_for_daemon_stop,
)


class ScoutSyncError(RuntimeError):
    """Raised when a local run cannot be synced to Atlas."""


@dataclass(frozen=True, slots=True)
class SetupProfileChoice:
    """Profile action selected during Scout setup."""

    action: Literal["continue", "create"]
    name: str | None


def _run_async[AsyncResult](coro: Coroutine[Any, Any, AsyncResult]) -> AsyncResult:
    """Run an async command through Scout's shared interrupt boundary."""
    try:
        return asyncio.run(coro)
    except KeyboardInterrupt as exc:
        raise click.Abort from exc


def _default_worker_name() -> str:
    """Return the display name Scout should use for this host device."""
    name = platform.node().strip()
    return name or "Scout worker"


def _require_local_worker_provider(config: ScoutConfig) -> None:
    """Refuse public worker mode when Scout is configured for a remote model provider."""
    provider = config.llm.provider.strip().lower()
    if provider not in LOCAL_WORKER_PROVIDERS:
        allowed = ", ".join(sorted(LOCAL_WORKER_PROVIDERS))
        raise click.ClickException(
            "Scout worker mode requires a local model provider before public launch. "
            f"Run `scout config model` to choose one of: {allowed}."
        )


def _prepare_local_model_config(
    config: ScoutConfig,
    *,
    config_path: Path,
    force_save: bool = False,
) -> LocalModelResolution | None:
    """Resolve and optionally save local model settings for commands that run work."""
    if not is_local_provider(config.llm.provider):
        return None

    resolution = resolve_local_model(config)
    if not resolution.ready:
        raise click.ClickException(_local_model_error_message(resolution))

    apply_local_model_resolution(config, resolution)
    if resolution.changed or force_save:
        _save_local_model_config(config_path, config, resolution)
    return resolution


def _resolve_or_repair_local_model(
    config: ScoutConfig,
    *,
    config_path: Path,
) -> LocalModelResolution:
    """Resolve a local model, attempting headless repairs before asking the user."""
    resolution = resolve_local_model(config)
    if resolution.ready:
        return resolution

    provider = _local_model_repair_provider(config, config_path=config_path)
    if provider is not None and _try_start_local_model_server(provider):
        resolution = resolve_local_model(config)
        if resolution.ready:
            return resolution

    return resolution


def _setup_local_model_provider(config: ScoutConfig) -> LocalModelResolution:
    """Run provider bootstrap first, then resolve models for that provider."""
    provider = _choose_setup_local_model_provider()
    if provider is None:
        return LocalModelResolution(
            ready=False,
            provider=None,
            model=None,
            base_url=None,
            message="No local model provider is ready.",
            remediation="Choose Ollama or LM Studio, then finish setup.",
        )

    previous_provider = config.llm.provider.strip().lower()
    config.llm.provider = provider
    if previous_provider != provider:
        config.llm.base_url = None
    _try_start_local_model_server(provider)
    resolution = resolve_local_model(config)
    return _resolution_for_provider(config, resolution, provider)


def _choose_setup_local_model_provider() -> LocalProviderName | None:
    """Choose or install a provider before model configuration."""
    installed_providers = _installed_local_model_providers()
    missing_providers = _missing_local_model_providers()
    providers = _ordered_provider_choices(installed_providers, missing_providers)
    if not providers:
        return None

    provider = (
        providers[0]
        if len(providers) == 1
        else _choose_local_model_provider_interactively(
            providers,
            installed_providers=installed_providers,
        )
    )
    if provider in installed_providers:
        return provider
    if _confirm_and_install_local_provider(provider):
        return provider
    return None


def _ordered_provider_choices(
    installed_providers: tuple[LocalProviderName, ...],
    missing_providers: tuple[LocalProviderName, ...],
) -> tuple[LocalProviderName, ...]:
    """Return provider choices without duplicating installed/missing providers."""
    providers: list[LocalProviderName] = []
    for provider in LOCAL_PROVIDER_NAMES:
        if provider in installed_providers or provider in missing_providers:
            providers.append(provider)
    for provider in (*installed_providers, *missing_providers):
        if provider not in providers:
            providers.append(provider)
    return tuple(providers)


def _confirm_and_install_local_provider(provider: LocalProviderName) -> bool:
    """Ask before installing a missing provider, then run the confirmed action."""
    plan = _install_plan_for_local_provider(provider)
    console.print()
    console.print(f"{provider_label(provider)} is not installed.")
    if plan.command:
        console.print("Scout can install it now:")
        console.print(f"  {' '.join(plan.command)}")
    elif plan.url is not None:
        console.print("Scout can open the installer:")
        console.print(f"  {plan.url}")
    if not click.confirm(plan.label, default=False):
        return False
    console.print(f"[dim]{plan.label}...[/]")
    return _install_local_model_provider(plan)


def _resolution_for_provider(
    config: ScoutConfig,
    resolution: LocalModelResolution,
    provider: LocalProviderName,
) -> LocalModelResolution:
    """Keep provider choice authoritative during setup model resolution."""
    choices = _choices_for_provider(resolution, provider)
    if choices:
        choice = _preferred_provider_choice(config, choices)
        return select_local_model_choice(config, choice, choices)
    if resolution.ready and resolution.provider == provider:
        return resolution
    return LocalModelResolution(
        ready=False,
        provider=None,
        model=None,
        base_url=None,
        message=f"{provider_label(provider)} is not ready.",
        remediation=_provider_not_ready_remediation(provider, resolution),
    )


def _choices_for_provider(
    resolution: LocalModelResolution,
    provider: LocalProviderName,
) -> tuple[LocalModelChoice, ...]:
    """Return ready model choices for the selected provider only."""
    return tuple(choice for choice in resolution.choices if choice.provider == provider)


def _preferred_provider_choice(
    config: ScoutConfig,
    choices: tuple[LocalModelChoice, ...],
) -> LocalModelChoice:
    """Prefer the configured model when it exists for the chosen provider."""
    return next((choice for choice in choices if choice.model == config.llm.model), choices[0])


def _provider_not_ready_remediation(
    provider: LocalProviderName,
    resolution: LocalModelResolution,
) -> str:
    """Return provider-specific setup remediation without falling back to another provider."""
    if resolution.remediation:
        return resolution.remediation
    return f"Start {provider_label(provider)} or download a chat model, then run `scout setup`."


def _local_model_repair_provider(
    config: ScoutConfig,
    *,
    config_path: Path,
) -> LocalProviderName | None:
    """Return the local provider setup may start without guessing."""
    installed_providers = _installed_local_model_providers()
    if not installed_providers:
        return None

    configured_provider = config.llm.provider.strip().lower()
    if (
        _local_provider_configured_explicitly(config_path)
        and configured_provider in installed_providers
    ):
        return configured_provider

    if len(installed_providers) == 1:
        return installed_providers[0]

    return _choose_local_model_provider_interactively(installed_providers)


def _installed_local_model_providers() -> tuple[LocalProviderName, ...]:
    """Return local model providers with installed command-line starters."""
    return installed_local_model_providers()


def _missing_local_model_providers() -> tuple[LocalProviderName, ...]:
    """Return local model providers Scout can help install."""
    return missing_local_model_providers()


def _install_plan_for_local_provider(provider: LocalProviderName) -> LocalProviderInstallPlan:
    """Return the best install action for one missing provider."""
    return install_plan_for_provider(provider)


def _install_local_model_provider(plan: LocalProviderInstallPlan) -> bool:
    """Run a user-confirmed local provider install action."""
    return install_local_model_provider(plan)


def _local_provider_configured_explicitly(config_path: Path) -> bool:
    """Return whether the active profile explicitly chose a local provider."""
    if not config_path.exists():
        return False
    try:
        with config_path.open("rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return False
    llm_config = data.get("llm")
    configured_keys = {"provider", "base_url", "ollama_base_url", "lmstudio_base_url"}
    return isinstance(llm_config, dict) and bool(configured_keys.intersection(llm_config))


def _try_start_local_model_server(provider: str) -> bool:
    """Start one installed local model server."""
    console.print(f"[dim]Starting {provider_label(provider)}...[/]")
    return start_local_model_server(provider)


def _local_model_error_message(resolution: LocalModelResolution) -> str:
    """Return concise local model failure copy."""
    if resolution.remediation:
        return f"{resolution.message} {resolution.remediation}"
    return resolution.message


def _save_local_model_config(
    config_path: Path,
    config: ScoutConfig,
    resolution: LocalModelResolution,
) -> None:
    """Persist selected local model settings without storing secrets."""
    if resolution.provider is None or resolution.model is None:
        return
    save_local_model_settings(
        config_path,
        config,
        provider=resolution.provider,
        model=resolution.model,
        base_url=resolution.base_url,
    )


def _print_local_model_resolution(
    resolution: LocalModelResolution | None,
    *,
    saved: bool,
) -> None:
    """Print the local model choice in a compact user-facing form."""
    if resolution is None or not resolution.ready:
        return
    console.print(resolution.message)
    if saved:
        console.print(f"[dim]Saved local model settings to profile: {get_active_profile_name()}[/]")


def _choose_local_model_interactively(
    config: ScoutConfig,
    resolution: LocalModelResolution,
) -> LocalModelResolution:
    """Let a user override automatic local model selection in setup."""
    if len(resolution.choices) <= 1:
        return resolution

    arrow_selection = _select_model_with_arrows(resolution.choices)
    if arrow_selection is not None:
        return select_local_model_choice(config, arrow_selection, resolution.choices)

    console.print()
    table = Table(title="Local models", show_lines=False, pad_edge=False)
    table.add_column("#", style="dim")
    table.add_column("Provider")
    table.add_column("Model", style="bold")
    for index, choice in enumerate(resolution.choices, start=1):
        table.add_row(str(index), provider_label(choice.provider), choice.model)
    console.print(table)
    selection = int(
        click.prompt(
            "Choose a model",
            type=click.IntRange(1, len(resolution.choices)),
            default=1,
            show_default=True,
        )
    )
    choice = resolution.choices[selection - 1]
    return select_local_model_choice(config, choice, resolution.choices)


def _select_model_with_arrows(
    choices: tuple[LocalModelChoice, ...],
) -> LocalModelChoice | None:
    """Use an arrow-key picker for model selection when a TTY is available."""
    try:
        return select_with_arrows(
            title="Local model",
            text="Choose the model Scout should use for discovery.",
            choices=tuple(
                InteractiveChoice(
                    value=choice,
                    label=choice.model,
                    detail=provider_label(choice.provider),
                )
                for choice in choices
            ),
        )
    except SelectionCancelledError as exc:
        raise click.Abort from exc


def _choose_local_model_provider_interactively(
    providers: tuple[LocalProviderName, ...],
    *,
    installed_providers: tuple[LocalProviderName, ...] | None = None,
) -> LocalProviderName:
    """Ask the user which installed local model server Scout should start."""
    installed = installed_providers or providers
    arrow_selection = _select_provider_with_arrows(providers, installed)
    if arrow_selection is not None:
        return arrow_selection

    console.print()
    table = Table(title="Local model providers", show_lines=False, pad_edge=False)
    table.add_column("#", style="dim")
    table.add_column("Provider", style="bold")
    table.add_column("Status")
    for index, provider in enumerate(providers, start=1):
        status = "installed" if provider in installed else "can install"
        table.add_row(str(index), provider_label(provider), status)
    console.print(table)
    selection = int(
        click.prompt(
            "Choose a provider",
            type=click.IntRange(1, len(providers)),
            default=1,
            show_default=True,
        )
    )
    return providers[selection - 1]


def _select_provider_with_arrows(
    providers: tuple[LocalProviderName, ...],
    installed_providers: tuple[LocalProviderName, ...],
) -> LocalProviderName | None:
    """Use an arrow-key picker for provider setup when a TTY is available."""
    try:
        return select_with_arrows(
            title="Local model provider",
            text="Choose the provider Scout should set up.",
            choices=tuple(
                InteractiveChoice(
                    value=provider,
                    label=provider_label(provider),
                    detail="installed" if provider in installed_providers else "can install",
                )
                for provider in providers
            ),
        )
    except SelectionCancelledError as exc:
        raise click.Abort from exc


def _should_prompt_for_setup_model_choice(
    resolution: LocalModelResolution,
) -> bool:
    """Return whether setup should ask the user to choose between ready models."""
    return resolution.ready and len(resolution.choices) > 1


def _search_key_configured() -> bool:
    """Return whether this process has search-backed discovery available."""
    return has_search_api_key()


def _print_credential_store_error(exc: CredentialStoreError) -> None:
    """Render a credential-store error without exposing secret values."""
    print_cli_error(err_console, _credential_store_cli_error(exc))


def _exit_with_error(error: CliError) -> NoReturn:
    """Render a structured CLI error to stderr and stop command execution."""
    print_cli_error(err_console, error)
    sys.exit(error.exit_code)


def _credential_store_cli_error(exc: CredentialStoreError) -> CliError:
    """Return a structured credential-storage error."""
    return CliError(title="Credential storage error", message=str(exc))


def _config_mutation_cli_error(exc: ConfigMutationError) -> CliError:
    """Return a structured config mutation error."""
    return CliError(title=exc.title, message=exc.message, hint=exc.hint)


def _resolve_search_connection(search_api_key: str | None) -> str:
    """Resolve the search credential from an override, environment, or OS storage."""
    try:
        return resolve_search_api_key(search_api_key)
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))


def _search_connection_required_error() -> CliError:
    """Return the standard missing-search-connection error."""
    return CliError(
        title="Search-backed discovery is not connected",
        message="Run `scout search connect`, or set SEARCH_API_KEY for automation.",
    )


def _require_search_connection(search_api_key: str | None) -> str:
    """Resolve a search credential or stop with the standard user-facing guidance."""
    resolved_search_key = _resolve_search_connection(search_api_key)
    if resolved_search_key:
        return resolved_search_key
    _exit_with_error(_search_connection_required_error())


def _login_failure_cli_error(exc: DeviceAuthError) -> CliError:
    """Return a structured Scout login error."""
    return CliError(title="Login failed", message=format_device_auth_error(exc))


def _load_session_or_exit() -> ScoutSession | None:
    """Load the Scout session or exit with a clear credential-store error."""
    try:
        return load_session()
    except CredentialStoreError as exc:
        _print_credential_store_error(exc)
        sys.exit(1)


def _load_session_or_click_exception() -> ScoutSession | None:
    """Load the Scout session or raise a Click error for worker commands."""
    try:
        return load_session()
    except CredentialStoreError as exc:
        raise click.ClickException(f"Credential storage error: {exc}") from exc


def _sync_daemon_module() -> None:
    """Keep legacy cli monkeypatch targets wired into the daemon helper module."""
    _daemon_helpers.asyncio = asyncio
    _daemon_helpers.console = console
    _daemon_helpers.os = os
    _daemon_helpers.signal = signal
    _daemon_helpers.subprocess = subprocess
    for name in _DAEMON_PATCH_TARGETS:
        setattr(_daemon_helpers, name, globals()[name])


async def _poll_device_token(
    client: DeviceAuthClient,
    atlas_url: str,
    code: DeviceCode,
) -> DeviceToken:
    """Poll Atlas until the browser-approved device session is ready."""
    interval = max(code.interval, 1)
    deadline = time.monotonic() + code.expires_in
    while time.monotonic() <= deadline:
        try:
            return await client.request_device_token(atlas_url, device_code=code.device_code)
        except DeviceAuthError as exc:
            if exc.error == "authorization_pending":
                await asyncio.sleep(interval)
                continue
            if exc.error == "slow_down":
                interval += 5
                await asyncio.sleep(interval)
                continue
            if exc.error == "network_error":
                interval *= 2
                await asyncio.sleep(interval)
                continue
            raise
    raise DeviceAuthError(
        error="expired_token",
        description="The device code expired before approval.",
    )


async def _login(
    *,
    atlas_url: str | None,
    target: UploadTarget | None,
    workspace: str | None,
    open_browser: bool,
) -> None:
    """Run Scout's browser-approved login flow."""
    resolved_atlas_url, _ = await _resolve_login_atlas_url(atlas_url)

    client = DeviceAuthClient()
    try:
        pending = await begin_login(
            client=client,
            atlas_url=resolved_atlas_url,
            target=target,
            workspace=workspace,
        )
    except DeviceAuthError as exc:
        _exit_with_error(_login_failure_cli_error(exc))

    print_login_instructions(console, pending.code)
    if open_browser:
        webbrowser.open(format_verification_uri_complete(pending.code))

    worker_name = _default_worker_name()
    try:
        session = await complete_login(
            pending,
            poll_device_token=_poll_device_token,
            worker_name=worker_name,
            search_key_configured=_search_key_configured(),
        )
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    except DeviceAuthError as exc:
        _exit_with_error(_login_failure_cli_error(exc))
    except LoginExecutionError as exc:
        _exit_with_error(CliError(title=exc.title, message=exc.message))

    try:
        save_session(session)
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    print_login_success(console, session.user_email)


async def _resolve_login_atlas_url(atlas_url: str | None) -> tuple[str, bool]:
    """Resolve the Atlas URL for a login command and whether it was auto-detected."""
    if atlas_url:
        return atlas_url.rstrip("/"), False
    return DEFAULT_ATLAS_URL, False


def _require_schedule_targets(config: ScoutConfig) -> int:
    _sync_daemon_module()
    return _ORIGINAL_REQUIRE_SCHEDULE_TARGETS(config)


async def _open_store(config: ScoutConfig) -> object:
    _sync_daemon_module()
    return await _ORIGINAL_OPEN_STORE(config)


def _daemon_process_is_running(process_id: int) -> bool:
    _sync_daemon_module()
    return _ORIGINAL_DAEMON_PROCESS_IS_RUNNING(process_id)


def _signal_daemon_process(process_id: int) -> None:
    _sync_daemon_module()
    _ORIGINAL_SIGNAL_DAEMON_PROCESS(process_id)


def _spawn_daemon_process(
    *,
    config_path: Path,
    debug: bool,
    search_api_key: str,
    interval: int,
) -> object:
    _sync_daemon_module()
    return _ORIGINAL_SPAWN_DAEMON_PROCESS(
        config_path=config_path,
        debug=debug,
        search_api_key=search_api_key,
        interval=interval,
    )


async def _wait_for_daemon_start(
    config: ScoutConfig,
    *,
    expected_pid: int,
    process: object,
    timeout_seconds: float = 5.0,
    poll_interval_seconds: float = 0.1,
) -> dict[str, object]:
    _sync_daemon_module()
    return await _ORIGINAL_WAIT_FOR_DAEMON_START(
        config,
        expected_pid=expected_pid,
        process=process,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )


async def _wait_for_daemon_stop(
    store: object,
    *,
    process_id: int,
    timeout_seconds: float = 10.0,
    poll_interval_seconds: float = 0.1,
) -> dict[str, object]:
    _sync_daemon_module()
    return await _ORIGINAL_WAIT_FOR_DAEMON_STOP(
        store,
        process_id=process_id,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )


def _render_recent_run_summary(run_record: dict[str, object] | None) -> str:
    return _ORIGINAL_RENDER_RECENT_RUN_SUMMARY(run_record)


def _render_recent_tick_summary(daemon_state: dict[str, object]) -> str:
    return _ORIGINAL_RENDER_RECENT_TICK_SUMMARY(daemon_state)


def _daemon_interval_metadata(config: ScoutConfig, *, interval: int) -> tuple[int, str]:
    _sync_daemon_module()
    return _ORIGINAL_DAEMON_INTERVAL_METADATA(config, interval=interval)


def _daemon_start_conflict_message(daemon_state: dict[str, object]) -> str:
    return _ORIGINAL_DAEMON_START_CONFLICT_MESSAGE(daemon_state)


def _daemon_start_claim_is_stale(
    daemon_state: dict[str, object], *, stale_after_seconds: float = 10.0
) -> bool:
    return _ORIGINAL_DAEMON_START_CLAIM_IS_STALE(
        daemon_state,
        stale_after_seconds=stale_after_seconds,
    )


async def _clear_failed_daemon_start(config: ScoutConfig, *, expected_pid: int | None) -> None:
    _sync_daemon_module()
    await _ORIGINAL_CLEAR_FAILED_DAEMON_START(config, expected_pid=expected_pid)


async def _daemon_start(
    config: ScoutConfig,
    *,
    config_path: Path,
    profile_name: str | None,
    debug: bool,
    search_api_key: str,
    interval: int,
) -> None:
    _sync_daemon_module()
    await _ORIGINAL_DAEMON_START(
        config,
        config_path=config_path,
        profile_name=profile_name,
        debug=debug,
        search_api_key=search_api_key,
        interval=interval,
    )


async def _daemon_stop(config: ScoutConfig) -> None:
    _sync_daemon_module()
    await _ORIGINAL_DAEMON_STOP(config)


async def _daemon_status(config: ScoutConfig) -> None:
    _sync_daemon_module()
    await _ORIGINAL_DAEMON_STATUS(config)


def _install_daemon_signal_handlers(stop_event: asyncio.Event) -> None:
    _sync_daemon_module()
    _ORIGINAL_INSTALL_DAEMON_SIGNAL_HANDLERS(stop_event)


async def _daemon_run_internal(
    config: ScoutConfig,
    *,
    config_path: Path,
    profile_name: str | None,
    search_api_key: str,
    interval: int,
) -> None:
    _sync_daemon_module()
    await _ORIGINAL_DAEMON_RUN_INTERNAL(
        config,
        config_path=config_path,
        profile_name=profile_name,
        search_api_key=search_api_key,
        interval=interval,
    )


def _runtime_profile_for_run(config: ScoutConfig, *, direct_mode: bool) -> RuntimeProfile:
    """Build a runtime profile for the current run mode."""
    try:
        return build_runtime_profile(config, direct_mode=direct_mode)
    except TypeError:
        return build_runtime_profile(config)


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


def _atlas_url_for_path(atlas_url: str, path: str) -> str:
    """Join an Atlas base URL and relative app path."""
    if path.startswith(("http://", "https://")):
        return path
    return f"{atlas_url.rstrip('/')}/{path.lstrip('/')}"


def _sync_visibility_label(link: SyncedEntryLink) -> str:
    """Return a compact human label for a synced entry receipt."""
    if link.visibility == "public":
        return "public profile"
    if link.visibility == "existing_shared":
        return "existing public profile"
    if link.visibility == "workspace_private":
        return "workspace private"
    return "held for review"


def _print_sync_receipt(
    *,
    local_run_id: str,
    atlas_url: str,
    result: ContributionResult,
) -> None:
    """Print a developer-facing receipt for a completed run sync."""
    message = "Already synced" if result.duplicate else "Synced"
    console.print(f"[green]{message}[/] run {local_run_id} -> [bold]{result.run_id}[/]")
    if result.run_id:
        console.print(
            f"Open run: {_atlas_url_for_path(atlas_url, f'/discovery?run={result.run_id}')}"
        )

    if not result.entry_links:
        return

    console.print("Entries:")
    for link in result.entry_links[:10]:
        entry_url = _atlas_url_for_path(atlas_url, link.url) if link.url else None
        suffix = f" - {entry_url}" if entry_url else ""
        console.print(f"  {link.name} - {_sync_visibility_label(link)}{suffix}")
    remaining = len(result.entry_links) - 10
    if remaining > 0:
        console.print(f"  +{remaining} more")


def _should_sync_after_run(
    config: ScoutConfig,
    *,
    result_artifacts_available: bool,
    sync_after_run: bool | None,
) -> bool:
    """Return whether a completed run should be synced automatically."""
    if sync_after_run is False:
        return False
    if not result_artifacts_available:
        if sync_after_run is True:
            err_console.print(
                "[yellow]Sync skipped:[/] this run did not produce canonical Atlas artifacts."
            )
        return False
    if sync_after_run is True:
        return True
    if config.contribution.enabled:
        return False
    try:
        return load_session() is not None
    except CredentialStoreError as exc:
        _print_credential_store_error(exc)
        return False


# ---------------------------------------------------------------------------
# Root group
# ---------------------------------------------------------------------------


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
    if config_path:
        path = Path(config_path)
    elif profile_name:
        path = SCOUT_CONFIGS_DIR / f"{profile_name}.toml"
        if not path.exists():
            available = sorted(p.stem for p in SCOUT_CONFIGS_DIR.glob("*.toml"))
            _exit_with_error(
                CliError(
                    title="Profile not found",
                    message=f"profile '{profile_name}' not found at {path}",
                    hint=f"Available profiles: {', '.join(available)}" if available else None,
                )
            )
    else:
        path = get_active_config_path()
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

    if debug:
        logging.basicConfig(
            level=logging.DEBUG,
            format="%(asctime)s %(name)s %(levelname)s: %(message)s",
            stream=sys.stderr,
        )
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("httpx").setLevel(logging.WARNING)
    else:
        logging.basicConfig(level=logging.WARNING, stream=sys.stderr)


# ---------------------------------------------------------------------------
# run command
# ---------------------------------------------------------------------------


@main.command()
@click.argument("urls", nargs=-1)
@click.option(
    "--file",
    "-f",
    "url_file",
    type=click.File("r"),
    default=None,
    help="File with URLs (one per line). Use '-' for stdin.",
)
@click.option(
    "--prompt", "prompt_text", default=None, help="Natural language directive to focus extraction."
)
@click.option(
    "--prompt-file",
    type=click.File("r"),
    default=None,
    help="File containing extraction directive.",
)
@click.option(
    "--provider", default=None, help="LLM provider override (ollama, lmstudio, anthropic)."
)
@click.option("--model", "model_name", default=None, help="Model name override.")
@click.option("--location", default=None, help="Location hint (e.g. 'Austin, TX').")
@click.option("--issues", default=None, help="Comma-separated issue area slugs.")
@click.option(
    "--depth",
    type=click.Choice(["standard", "deep"]),
    default="standard",
    show_default=True,
    help="Discovery depth (search mode).",
)
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option(
    "--follow-links/--no-follow-links",
    default=None,
    help="Follow same-domain links discovered during fetches.",
)
@click.option(
    "--max-link-depth",
    type=int,
    default=None,
    help="Maximum crawl depth when following discovered links.",
)
@click.option(
    "--max-pages-per-seed",
    type=int,
    default=None,
    help="Maximum total pages to queue from each seed URL.",
)
@click.option(
    "--refresh", is_flag=True, help="Bypass cached fetch and extraction results for this run."
)
@click.option(
    "--verbose-progress",
    is_flag=True,
    help="Show internal worker and queue events instead of the default user-facing firehose.",
)
@click.option(
    "--sync/--no-sync",
    "sync_after_run",
    default=None,
    help="Sync canonical run artifacts to Atlas after the run finishes.",
)
@click.option("--quiet", "-q", is_flag=True, help="Headless mode — suppress progress.")
@click.pass_context
def run(
    ctx: click.Context,
    urls: tuple[str, ...],
    url_file: click.utils.LazyFile | None,
    prompt_text: str | None,
    prompt_file: click.utils.LazyFile | None,
    provider: str | None,
    model_name: str | None,
    location: str | None,
    issues: str | None,
    depth: str,
    search_api_key: str | None,
    follow_links: bool | None,
    max_link_depth: int | None,
    max_pages_per_seed: int | None,
    refresh: bool,
    verbose_progress: bool,
    sync_after_run: bool | None,
    quiet: bool,
) -> None:
    """Run a discovery pipeline.

    \b
    Scrape URLs directly:
        scout run https://example.com/article
        scout run -f urls.txt
    \b
    Focus the extraction:
        scout run --prompt "Find free legal aid orgs" https://example.com
    \b
    Search mode:
        scout search connect
        scout run --location "Austin, TX" --issues housing_affordability
    """
    config: ScoutConfig = ctx.obj["config"]

    if provider:
        config.llm.provider = provider
    if model_name:
        config.llm.model = model_name

    # Merge URLs from positional args + file
    url_list: list[str] = list(urls) if urls else []
    if url_file:
        for line in url_file:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                url_list.append(stripped)

    # Resolve extraction directive
    directive: str | None = prompt_text
    if prompt_file and not directive:
        directive = prompt_file.read().strip()

    issue_list = [i.strip() for i in issues.split(",") if i.strip()] if issues else []

    if follow_links is not None:
        config.scraper.follow_links = follow_links
    if max_link_depth is not None:
        config.scraper.max_link_depth = max_link_depth
    if max_pages_per_seed is not None:
        config.scraper.max_pages_per_seed = max_pages_per_seed

    # Validation
    resolved_search_key = search_api_key
    if not url_list:
        resolved_search_key = _resolve_search_connection(search_api_key)
        if not resolved_search_key:
            err_console.print(
                "[bold]Direct URL discovery[/]\n"
                "  scout run <url> [<url> ...]\n"
                "  scout run -f urls.txt\n\n"
                "[bold]Search-backed discovery[/]\n"
                "  scout search connect\n"
                "  scout run --location 'City, ST' --issues <slugs>\n\n"
                "Run `scout doctor` to check model, search, sync, and local data readiness."
            )
            sys.exit(1)
        if not location:
            _exit_with_error(
                CliError(title="Missing option", message="--location is required for search mode.")
            )
        if not issue_list:
            _exit_with_error(
                CliError(title="Missing option", message="--issues is required for search mode.")
            )

    try:
        resolution = _prepare_local_model_config(
            config,
            config_path=ctx.obj["config_path"],
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Local model unavailable", message=exc.message))

    if not quiet:
        profile = _runtime_profile_for_run(config, direct_mode=bool(url_list))
        _print_local_model_resolution(
            resolution,
            saved=bool(resolution and resolution.changed),
        )
        print_run_banner(
            console,
            config=config,
            profile=profile,
            refresh=refresh,
            directive=directive,
            location=location,
            url_count=len(url_list),
        )

    _run_async(
        _run_pipeline(
            config=config,
            location=location or "",
            issues=issue_list,
            depth=depth,
            search_api_key=resolved_search_key,
            direct_urls=url_list or None,
            quiet=quiet,
            directive=directive,
            refresh=refresh,
            verbose_progress=verbose_progress,
            sync_after_run=sync_after_run,
        )
    )


async def _run_pipeline(
    config: ScoutConfig,
    location: str,
    issues: list[str],
    depth: str,
    search_api_key: str | None,
    direct_urls: list[str] | None = None,
    quiet: bool = False,
    directive: str | None = None,
    refresh: bool = False,
    verbose_progress: bool = False,
    sync_after_run: bool | None = None,
    sync_remote_run_id: str | None = None,
) -> None:
    """Create infrastructure, run the pipeline, print results."""
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    store = ScoutStore(str(db_path))
    await store.initialize()

    normalized_direct_urls = [url.strip().rstrip("/") for url in (direct_urls or []) if url.strip()]
    if normalized_direct_urls and not refresh:
        existing_run_id = await store.find_running_direct_run(normalized_direct_urls)
        if existing_run_id is not None:
            print_duplicate_run_notice(console, existing_run_id)
            await store.close()
            return

    profile = _runtime_profile_for_run(config, direct_mode=bool(direct_urls))
    provider = _build_provider(config, max_concurrent=profile.extract_concurrency)

    fetcher = AsyncFetcher(
        max_concurrent=profile.fetch_concurrency,
        request_delay_ms=config.scraper.request_delay_ms,
        page_cache_ttl_days=config.scraper.page_cache_ttl_days,
        revisit_cached_urls=config.scraper.revisit_cached_urls,
        store=store,
        run_id="pending",
        force_refresh=refresh,
        browser_fallback_enabled=config.scraper.browser_fallback_enabled,
        browser_render_timeout_ms=config.scraper.browser_render_timeout_ms,
        max_browser_renders_per_run=config.scraper.max_browser_renders_per_run,
        max_browser_concurrent=config.scraper.max_browser_concurrent,
    )
    progress = ProgressRenderer(console=console, quiet=quiet, verbose=verbose_progress)

    try:
        result = await run_pipeline(
            location=location,
            issues=issues,
            provider=provider,
            store=store,
            search_api_key=search_api_key or "",
            search_depth=depth,
            min_entry_score=config.pipeline.min_entry_score,
            reuse_cached_extractions=config.pipeline.reuse_cached_extractions and not refresh,
            fetcher=fetcher,
            direct_urls=direct_urls,
            on_progress=progress.emit,
            extraction_directive=directive,
            search_concurrency=profile.search_concurrency,
            follow_links=config.scraper.follow_links,
            max_link_depth=config.scraper.max_link_depth,
            max_pages_per_seed=config.scraper.max_pages_per_seed,
            iterative_deepening=config.pipeline.iterative_deepening,
            contribution_config=config.contribution,
            remote_run_id=sync_remote_run_id,
        )
    finally:
        await _close_if_supported(fetcher)
        await _close_if_supported(provider)
        await store.close()

    print_run_results(console, result)
    if _should_sync_after_run(
        config,
        result_artifacts_available=result.artifacts is not None,
        sync_after_run=sync_after_run,
    ):
        await _runs_sync(
            config,
            result.run_id,
            atlas_url=None,
            api_key=None,
            target=None,
            workspace=None,
        )


def _build_provider(config: ScoutConfig, *, max_concurrent: int | None = None) -> LLMProvider:
    """Instantiate the configured LLM provider."""
    from atlas_scout.providers import create_provider

    return create_provider(config.llm, max_concurrent=max_concurrent)


# ---------------------------------------------------------------------------
# doctor command
# ---------------------------------------------------------------------------


@main.command("doctor")
@click.option(
    "--worker", "include_worker", is_flag=True, help="Include background worker readiness."
)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def doctor(ctx: click.Context, include_worker: bool, json_output: bool) -> None:
    """Check whether Scout is ready to run discovery and sync results."""
    config: ScoutConfig = ctx.obj["config"]
    report = run_doctor(config, include_worker=include_worker)
    if json_output:
        click.echo(report.to_json())
    else:
        print_doctor_report(console, report)
    sys.exit(report.exit_code)


# ---------------------------------------------------------------------------
# sync command
# ---------------------------------------------------------------------------


@main.command("sync")
@click.argument("run_ids", nargs=-1)
@click.option("--all-ready", is_flag=True, help="Sync every completed run with ready artifacts.")
@click.option("--atlas-url", default=None, help="Override the Atlas base URL for sync.")
@click.option("--api-key", default=None, envvar="ATLAS_API_KEY", help="Override the Atlas API key.")
@click.option(
    "--target",
    type=click.Choice(["public", "workspace"]),
    default=None,
    help="Upload destination for logged-in Scout syncs.",
)
@click.option("--workspace", default=None, help="Workspace id for workspace-private sync.")
@click.pass_context
def sync(
    ctx: click.Context,
    run_ids: tuple[str, ...],
    all_ready: bool,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync the latest, selected, or all ready local runs to Atlas."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _sync_runs(
            config,
            run_ids,
            all_ready=all_ready,
            atlas_url=atlas_url,
            api_key=api_key,
            target=target,
            workspace=workspace,
        )
    )


async def _resolve_sync_run_ids(
    config: ScoutConfig,
    *,
    run_ids: tuple[str, ...],
    all_ready: bool,
) -> list[str]:
    """Resolve top-level sync selectors into concrete local run IDs."""
    if all_ready and run_ids:
        raise ScoutSyncError("Use either explicit run ids or --all-ready, not both.")
    if run_ids and run_ids != ("latest",) and not all_ready:
        return list(run_ids)

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        limit = None if all_ready else 1
        resolved = await store.list_syncable_run_ids(limit=limit)
    finally:
        await store.close()

    if not resolved:
        raise ScoutSyncError("No completed runs with ready artifacts.")
    return resolved


async def _sync_runs(
    config: ScoutConfig,
    run_ids: tuple[str, ...],
    *,
    all_ready: bool,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync one or more local runs to Atlas."""
    try:
        resolved_run_ids = await _resolve_sync_run_ids(
            config,
            run_ids=run_ids,
            all_ready=all_ready,
        )
        for run_id in resolved_run_ids:
            await _runs_sync(
                config,
                run_id,
                atlas_url=atlas_url,
                api_key=api_key,
                target=target,
                workspace=workspace,
            )
    except ScoutSyncError as exc:
        _exit_with_error(CliError(title="Sync failed", message=str(exc)))


# ---------------------------------------------------------------------------
# db commands
# ---------------------------------------------------------------------------


@main.group()
def db() -> None:
    """Manage the local Scout database."""


@db.command("reset")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation.")
@click.pass_context
def db_reset(ctx: click.Context, yes: bool) -> None:
    """Delete all local data (runs, entries, pages)."""
    config: ScoutConfig = ctx.obj["config"]
    db_path = Path(config.store.path).expanduser()
    if not yes and not click.confirm("Delete all Scout data?"):
        console.print("[dim]Cancelled.[/]")
        return
    if db_path.exists():
        db_path.unlink()
        console.print(f"  [red]Deleted[/] {db_path}")
    console.print("[green]Database reset.[/]")


@db.command("path")
@click.pass_context
def db_path_cmd(ctx: click.Context) -> None:
    """Print the database file path."""
    config: ScoutConfig = ctx.obj["config"]
    console.print(Path(config.store.path).expanduser())


# ---------------------------------------------------------------------------
# config commands
# ---------------------------------------------------------------------------


@main.group("config")
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
        apply_local_model_resolution(config, resolution)
        _save_local_model_config(ctx.obj["config_path"], config, resolution)
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Local model unavailable", message=exc.message))

    _print_local_model_resolution(resolution, saved=True)


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


# ---------------------------------------------------------------------------
# setup commands
# ---------------------------------------------------------------------------


@main.command("setup")
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


# ---------------------------------------------------------------------------
# runs commands
# ---------------------------------------------------------------------------

_TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled"}


@main.group()
def runs() -> None:
    """Manage discovery runs."""


@runs.command("list")
@click.option("--limit", default=20, show_default=True)
@click.pass_context
def runs_list(ctx: click.Context, limit: int) -> None:
    """List recent discovery runs."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_list(config, limit))


async def _runs_list(config: ScoutConfig, limit: int) -> None:
    """Fetch and print recent runs."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        records = await store.list_runs(limit=limit)
    finally:
        await store.close()
    if not records:
        console.print("[dim]No runs found.[/]")
        return
    table = Table(show_lines=False, pad_edge=False)
    table.add_column("ID", style="bold")
    table.add_column("Status")
    table.add_column("Location")
    table.add_column("Entries", justify="right")
    table.add_column("Created", style="dim")
    for r in records:
        table.add_row(
            r["id"],
            styled_status(r["status"]),
            r["location"] or "—",
            str(r.get("entries_found") or 0),
            r["created_at"][:19],
        )
    console.print(table)


@runs.command("inspect")
@click.argument("run_id")
@click.pass_context
def runs_inspect(ctx: click.Context, run_id: str) -> None:
    """Show details of a specific run."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_inspect(config, run_id))


async def _runs_inspect(config: ScoutConfig, run_id: str) -> None:
    """Print detailed run information."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            rec = await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)
        artifacts = await store.get_run_artifacts(run_id)
        entries = await store.list_entries(run_id=run_id)
        page_tasks = await store.list_page_tasks(run_id)
    finally:
        await store.close()

    console.print(f"[bold]Run {rec['id']}[/]")
    console.print(f"  Status: {styled_status(rec['status'])}")
    if rec["location"]:
        console.print(f"  Location: {rec['location']}")
    console.print(f"  Created: [dim]{rec['created_at'][:19]}[/]")
    if rec.get("completed_at"):
        console.print(f"  Completed: [dim]{rec['completed_at'][:19]}[/]")
    if rec.get("error"):
        console.print(f"  Error: [red]{rec['error']}[/]")
    if artifacts and artifacts.manifest.sync:
        sync = artifacts.manifest.sync
        console.print(f"  Sync: {sync.sync_status or 'pending'}")
        if sync.remote_run_id:
            console.print(f"  Remote run: [dim]{sync.remote_run_id}[/]")
        if sync.last_error:
            console.print(f"  Sync error: [red]{sync.last_error}[/]")

    if page_tasks:
        console.print()
        pt_table = Table(title=f"Pages ({len(page_tasks)})", show_lines=False, pad_edge=False)
        pt_table.add_column("Status")
        pt_table.add_column("Detail")
        pt_table.add_column("URL", style="dim")
        for pt in page_tasks:
            detail = ""
            if pt.get("entries_extracted"):
                detail = f"{pt['entries_extracted']} entries"
            elif pt.get("error"):
                detail = pt["error"]
            pt_table.add_row(styled_status(pt["status"]), detail, pt["url"])
        console.print(pt_table)

    if entries:
        console.print()
        for e in entries:
            console.print(
                f"  [{e['score']:.2f}] {e['name']} ({e['entry_type']}) — {e.get('city')}, {e.get('state')}"
            )
    else:
        console.print("\n[dim]No entries.[/]")


@runs.command("cancel")
@click.argument("run_id")
@click.pass_context
def runs_cancel(ctx: click.Context, run_id: str) -> None:
    """Mark a local run record as cancelled."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_runs_cancel(config, run_id))


async def _runs_cancel(config: ScoutConfig, run_id: str) -> None:
    """Cancel a non-terminal local run record without interrupting active work."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            record = await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)

        status = str(record["status"])
        if status in _TERMINAL_RUN_STATUSES:
            err_console.print(
                f"[yellow]Run already {status}:[/] {run_id}. "
                "scout runs cancel only updates local Scout run records and does not "
                "interrupt active work."
            )
            sys.exit(1)

        await store.cancel_run(
            run_id,
            error="Cancelled locally via CLI; active work is not interrupted.",
        )
    finally:
        await store.close()

    console.print(
        f"[green]Cancelled local run[/] {run_id}. "
        "This updates Scout's local run record only and does not interrupt active work."
    )


@runs.command("sync")
@click.argument("run_id")
@click.option("--atlas-url", default=None, help="Override the Atlas base URL for sync.")
@click.option("--api-key", default=None, envvar="ATLAS_API_KEY", help="Override the Atlas API key.")
@click.option(
    "--target",
    type=click.Choice(["public", "workspace"]),
    default=None,
    help="Upload destination for logged-in Scout syncs.",
)
@click.option("--workspace", default=None, help="Workspace id for workspace-private sync.")
@click.pass_context
def runs_sync(
    ctx: click.Context,
    run_id: str,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync a completed local run to Atlas."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _runs_sync(
            config,
            run_id,
            atlas_url=atlas_url,
            api_key=api_key,
            target=target,
            workspace=workspace,
        )
    )


async def _runs_sync(
    config: ScoutConfig,
    run_id: str,
    *,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None = None,
    workspace: str | None = None,
) -> None:
    """Load a local run bundle and sync it to Atlas."""
    from atlas_scout.steps.contribute import sync_run_artifacts
    from atlas_scout.store import ScoutStore

    session = None
    resolved_api_key = api_key or config.contribution.api_key
    if not resolved_api_key:
        session = _load_session_or_exit()

    resolved_atlas_url = atlas_url or config.contribution.atlas_url
    if session is not None:
        resolved_atlas_url = atlas_url or session.atlas_url or config.contribution.atlas_url

    if not resolved_atlas_url:
        err_console.print(
            "[red]Atlas URL required:[/] set contribution.atlas_url or pass --atlas-url."
        )
        sys.exit(1)
    if not resolved_api_key and session is None:
        err_console.print(
            "[red]Authentication required:[/] Log in with `scout login` or pass --api-key."
        )
        sys.exit(1)

    resolved_target = target or (session.default_upload_target if session else None)
    resolved_workspace = workspace or (session.workspace_id if session else None)
    if session is not None and resolved_target is None:
        resolved_target = "public"
    if resolved_target == "public":
        resolved_workspace = None
    if session is not None and resolved_target == "workspace" and not resolved_workspace:
        err_console.print(
            "[red]Workspace required:[/] pass --workspace for workspace-private sync."
        )
        sys.exit(1)

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)

        artifacts = await store.get_run_artifacts(run_id)
        if artifacts is None:
            err_console.print(f"[red]Run artifacts missing:[/] {run_id}")
            sys.exit(1)

        await store.update_run_sync(run_id, sync_status="syncing")
        if session is not None:
            if resolved_target is None:
                raise ScoutSyncError("Upload target was not resolved for logged-in sync.")
            session_target: UploadTarget = resolved_target
            token_exchange = await DeviceAuthClient().exchange_session_for_api_token(
                resolved_atlas_url,
                session_token=session.access_token,
                worker_id=session.worker_id,
                worker_name=session.worker_name or _default_worker_name(),
                default_upload_target=session_target,
                workspace_id=resolved_workspace,
                search_key_configured=_search_key_configured(),
            )
            result = await sync_run_artifacts(
                artifacts,
                atlas_url=resolved_atlas_url,
                api_key="",
                bearer_token=token_exchange.token,
                target=resolved_target,
                workspace_id=resolved_workspace,
            )
        else:
            result = await sync_run_artifacts(
                artifacts,
                atlas_url=resolved_atlas_url,
                api_key=resolved_api_key,
            )
        if result.errors:
            sync_error = "; ".join(result.errors)
            await store.update_run_sync(
                run_id,
                sync_status="failed",
                last_error=sync_error,
            )
            _exit_with_error(CliError(title="Sync failed", message=sync_error))

        await store.update_run_sync(
            run_id,
            sync_status=result.sync_status or "synced",
            remote_run_id=result.run_id,
        )
    finally:
        await store.close()

    _print_sync_receipt(
        local_run_id=run_id,
        atlas_url=resolved_atlas_url,
        result=result,
    )


@main.command("login")
@click.option(
    "--atlas-url",
    default=None,
    help=(f"Atlas app URL to authenticate against. Defaults to {DEFAULT_ATLAS_URL}."),
)
@click.option(
    "--target",
    type=click.Choice(["public", "workspace"]),
    default=None,
    help="Default upload destination to remember. Defaults to public unless --workspace is passed.",
)
@click.option("--workspace", default=None, help="Workspace id for workspace-private sync.")
@click.option("--no-browser", is_flag=True, help="Print the approval URL without opening it.")
def login(
    atlas_url: str | None, target: UploadTarget | None, workspace: str | None, no_browser: bool
) -> None:
    """Log in to Atlas from the browser and remember this computer."""
    _run_async(
        _login(
            atlas_url=atlas_url,
            target=target,
            workspace=workspace,
            open_browser=not no_browser,
        )
    )


@main.group("auth")
def auth_group() -> None:
    """Manage Scout authentication."""


@auth_group.command("status")
def auth_status() -> None:
    """Show the current Scout login state."""
    session = _load_session_or_exit()
    if session is None:
        console.print("[yellow]Not logged in.[/]")
        return
    console.print("[bold]Scout auth[/]")
    console.print(f"  Atlas: {session.atlas_url}")
    console.print(f"  User: {session.user_email}")
    console.print(f"  Worker: {session.worker_name or session.worker_id}")
    console.print(f"  Worker id: {session.worker_id}")
    console.print(f"  Upload target: {session.default_upload_target or 'not set'}")
    console.print("  Credential storage: OS credential store")
    if session.workspace_id:
        console.print(f"  Workspace: {session.workspace_id}")


@main.command("whoami")
def whoami() -> None:
    """Show the signed-in Atlas user."""
    session = _load_session_or_exit()
    if session is None:
        console.print("[yellow]Not logged in.[/]")
        return
    console.print(session.user_email)


@main.command("logout")
def logout() -> None:
    """Remove the local Scout login session."""
    try:
        delete_session()
    except CredentialStoreError as exc:
        _exit_with_error(
            CliError(
                title="Logout failed",
                message="Scout could not remove local credentials from the OS credential store.",
                hint=str(exc),
            )
        )
    console.print("[green]Logged out.[/]")


@main.group("search")
def search_group() -> None:
    """Manage search-backed discovery."""


@search_group.command("connect")
@click.option("--key", "search_key", default=None, help="Search provider API key.")
def search_connect(search_key: str | None) -> None:
    """Connect Scout to search-backed discovery."""
    key = search_key or click.prompt("Search provider API key", hide_input=True)
    try:
        save_search_api_key(key)
    except (CredentialStoreError, ValueError) as exc:
        _exit_with_error(CliError(title="Search not connected", message=str(exc)))
    console.print("[green]Search-backed discovery connected.[/]")
    console.print("  Source: OS credential store")


@search_group.command("status")
def search_status() -> None:
    """Show whether Scout can run search-backed discovery."""
    if os.environ.get("SEARCH_API_KEY", "").strip():
        console.print("[green]Search-backed discovery available.[/]")
        console.print("  Source: SEARCH_API_KEY")
        return
    try:
        if has_search_api_key():
            console.print("[green]Search-backed discovery available.[/]")
            console.print("  Source: OS credential store")
            return
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    console.print("[yellow]Search-backed discovery not connected.[/]")
    console.print("  Run `scout search connect`.")


@search_group.command("disconnect")
def search_disconnect() -> None:
    """Disconnect Scout from stored search-backed discovery credentials."""
    try:
        deleted = delete_stored_search_api_key()
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    env_key_configured = bool(os.environ.get("SEARCH_API_KEY", "").strip())
    if deleted:
        console.print("[green]Search-backed discovery disconnected.[/]")
        if env_key_configured:
            console.print("  SEARCH_API_KEY is still set for this shell.")
        return
    console.print("[yellow]No stored search connection.[/]")
    if env_key_configured:
        console.print("  SEARCH_API_KEY is still set for this shell.")


def _now_iso() -> str:
    """Return a UTC timestamp for worker state files."""
    return datetime.now(UTC).isoformat()


def _read_worker_state() -> dict[str, object]:
    """Read the local Atlas worker state file."""
    if not WORKER_STATE_PATH.exists():
        return {"status": "stopped"}
    with WORKER_STATE_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {"status": "stopped"}
    return cast("dict[str, object]", payload)


def _write_worker_state(**state: object) -> None:
    """Persist local Atlas worker state."""
    payload = {**_read_worker_state(), **state, "updated_at": _now_iso()}
    WORKER_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with WORKER_STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    WORKER_STATE_PATH.chmod(0o600)


def _write_stopped_worker_state() -> None:
    """Persist a stopped worker state without stale live metadata."""
    _write_worker_state(**_WORKER_STOPPED_STATE)


def _worker_state_running(state: dict[str, object]) -> bool:
    """Return whether the tracked Atlas worker process is running."""
    process_id = state.get("process_id")
    return (
        state.get("status") == "running"
        and isinstance(process_id, int)
        and _daemon_process_is_running(process_id)
    )


async def _worker_api_token(
    *,
    atlas_url: str,
    session: ScoutSession,
    search_api_key: str,
) -> str:
    """Exchange the saved Scout session for a short-lived API token."""
    default_upload_target: UploadTarget = session.default_upload_target or "public"
    workspace_id = session.workspace_id if default_upload_target == "workspace" else None
    exchange = await DeviceAuthClient().exchange_session_for_api_token(
        atlas_url,
        session_token=session.access_token,
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        default_upload_target=default_upload_target,
        workspace_id=workspace_id,
        search_key_configured=bool(search_api_key),
    )
    return exchange.token


async def _worker_post(
    *,
    atlas_url: str,
    token: str,
    path: str,
    payload: dict[str, object],
) -> dict[str, object]:
    """POST to the Atlas worker API and return a JSON object."""
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{atlas_url.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.is_error:
        raise ScoutSyncError(f"Atlas worker API failed: HTTP {response.status_code}")
    body = response.json()
    if not isinstance(body, dict):
        raise ScoutSyncError("Atlas worker API returned an invalid response.")
    return cast("dict[str, object]", body)


async def _worker_claim_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    lease_seconds: int,
    search_key_configured: bool,
) -> dict[str, object] | None:
    """Claim the next Atlas discovery job, if any."""
    body = await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path="/api/discovery-runs/jobs/claim",
        payload={
            "worker_id": worker_id,
            "lease_seconds": lease_seconds,
            "search_key_configured": search_key_configured,
        },
    )
    job = body.get("job")
    if job is None:
        return None
    if not isinstance(job, dict):
        raise ScoutSyncError("Atlas worker claim returned an invalid job.")
    return cast("dict[str, object]", job)


async def _worker_heartbeat_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
    lease_seconds: int,
    progress: dict[str, object],
) -> None:
    """Renew one Atlas job lease."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/heartbeat",
        payload={
            "worker_id": worker_id,
            "lease_seconds": lease_seconds,
            "progress": progress,
        },
    )


async def _worker_complete_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
) -> None:
    """Mark one Atlas job lease complete."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/complete",
        payload={"worker_id": worker_id},
    )


async def _worker_fail_job(
    *,
    atlas_url: str,
    token: str,
    worker_id: str,
    job_id: str,
    error_message: str,
    retryable: bool,
) -> None:
    """Report one failed Atlas job lease."""
    await _worker_post(
        atlas_url=atlas_url,
        token=token,
        path=f"/api/discovery-runs/jobs/{job_id}/fail",
        payload={
            "worker_id": worker_id,
            "error_message": error_message,
            "retryable": retryable,
        },
    )


def _worker_job_issues(job: dict[str, object]) -> list[str]:
    """Return issue slugs from a worker job payload."""
    raw_issues = job.get("issue_areas")
    if not isinstance(raw_issues, list) or not all(isinstance(item, str) for item in raw_issues):
        raise ScoutSyncError("Atlas worker job is missing issue areas.")
    return list(raw_issues)


def _worker_job_execution_mode(job: dict[str, object]) -> str:
    """Return the worker execution mode for a claimed job."""
    raw_mode = job.get("execution_mode", "search")
    if raw_mode not in {"search", "direct_url"}:
        raise ScoutSyncError(f"Unsupported Atlas worker job mode: {raw_mode}")
    return str(raw_mode)


def _worker_job_direct_urls(job: dict[str, object]) -> list[str]:
    """Return seed URLs from a direct-URL worker job payload."""
    payload = job.get("input_payload")
    if not isinstance(payload, dict):
        raise ScoutSyncError("Atlas direct-URL job is missing input payload.")
    raw_urls = payload.get("direct_urls")
    if not isinstance(raw_urls, list) or not all(isinstance(url, str) for url in raw_urls):
        raise ScoutSyncError("Atlas direct-URL job is missing direct URLs.")
    urls = [url.strip() for url in raw_urls if url.strip()]
    if not urls:
        raise ScoutSyncError("Atlas direct-URL job has no usable direct URLs.")
    return urls


async def _worker_process_job(
    config: ScoutConfig,
    *,
    atlas_url: str,
    session: ScoutSession,
    token: str,
    job: dict[str, object],
    search_api_key: str,
    lease_seconds: int,
) -> None:
    """Run one claimed Atlas worker job and report completion or failure."""
    job_id = str(job["id"])
    run_id = str(job["run_id"])
    location = str(job["location_query"])
    issues = _worker_job_issues(job)
    execution_mode = _worker_job_execution_mode(job)
    direct_urls = _worker_job_direct_urls(job) if execution_mode == "direct_url" else None

    _write_worker_state(
        mode="processing",
        current_job_id=job_id,
        current_location=location,
        last_heartbeat_at=_now_iso(),
    )
    await _worker_heartbeat_job(
        atlas_url=atlas_url,
        token=token,
        worker_id=session.worker_id,
        job_id=job_id,
        lease_seconds=lease_seconds,
        progress={"step": "claimed", "claimed_at": _now_iso()},
    )

    heartbeat_stop = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        _worker_heartbeat_loop(
            atlas_url=atlas_url,
            session=session,
            search_api_key=search_api_key,
            job_id=job_id,
            lease_seconds=lease_seconds,
            stop_event=heartbeat_stop,
        )
    )
    try:
        await _run_pipeline(
            config=config,
            location=location,
            issues=issues,
            depth="standard",
            search_api_key=search_api_key,
            direct_urls=direct_urls,
            quiet=True,
            sync_after_run=True,
            sync_remote_run_id=run_id,
        )
    except Exception as exc:
        failure_token = await _worker_api_token(
            atlas_url=atlas_url,
            session=session,
            search_api_key=search_api_key,
        )
        await _worker_fail_job(
            atlas_url=atlas_url,
            token=failure_token,
            worker_id=session.worker_id,
            job_id=job_id,
            error_message=str(exc),
            retryable=True,
        )
        _write_worker_state(
            mode="error",
            current_job_id=None,
            last_error=str(exc),
            last_heartbeat_at=_now_iso(),
        )
        return
    finally:
        heartbeat_stop.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    complete_token = await _worker_api_token(
        atlas_url=atlas_url,
        session=session,
        search_api_key=search_api_key,
    )
    await _worker_complete_job(
        atlas_url=atlas_url,
        token=complete_token,
        worker_id=session.worker_id,
        job_id=job_id,
    )
    _write_worker_state(
        mode="idle",
        current_job_id=None,
        last_completed_job_id=job_id,
        last_heartbeat_at=_now_iso(),
    )


async def _worker_heartbeat_loop(
    *,
    atlas_url: str,
    session: ScoutSession,
    search_api_key: str,
    job_id: str,
    lease_seconds: int,
    stop_event: asyncio.Event,
) -> None:
    """Heartbeat a running Atlas job until processing finishes."""
    interval = max(10, min(60, lease_seconds // 3))
    while not stop_event.is_set():
        await asyncio.sleep(interval)
        if stop_event.is_set():
            return
        token = await _worker_api_token(
            atlas_url=atlas_url,
            session=session,
            search_api_key=search_api_key,
        )
        await _worker_heartbeat_job(
            atlas_url=atlas_url,
            token=token,
            worker_id=session.worker_id,
            job_id=job_id,
            lease_seconds=lease_seconds,
            progress={"step": "running", "heartbeat_at": _now_iso()},
        )
        _write_worker_state(last_heartbeat_at=_now_iso())


async def _worker_run_internal(
    config: ScoutConfig,
    *,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Run the Atlas worker foreground loop used by the background process."""
    session = _load_session_or_click_exception()
    if session is None:
        raise click.ClickException("Log in with `scout login` before starting the worker.")
    _require_local_worker_provider(config)
    resolved_atlas_url = (atlas_url or session.atlas_url).rstrip("/")
    resolved_search_key = resolve_search_api_key(search_api_key)
    stop_event = asyncio.Event()
    _install_daemon_signal_handlers(stop_event)
    _write_worker_state(
        status="running",
        process_id=os.getpid(),
        atlas_url=resolved_atlas_url,
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        search_key_configured=bool(resolved_search_key),
        started_at=_now_iso(),
    )

    while not stop_event.is_set():
        if not resolved_search_key:
            _write_worker_state(mode="waiting_for_seeded_jobs", current_job_id=None)

        try:
            token = await _worker_api_token(
                atlas_url=resolved_atlas_url,
                session=session,
                search_api_key=resolved_search_key,
            )
            job = await _worker_claim_job(
                atlas_url=resolved_atlas_url,
                token=token,
                worker_id=session.worker_id,
                lease_seconds=lease_seconds,
                search_key_configured=bool(resolved_search_key),
            )
            if job is None:
                _write_worker_state(
                    mode="idle" if resolved_search_key else "waiting_for_seeded_jobs",
                    current_job_id=None,
                    last_heartbeat_at=_now_iso(),
                )
                await asyncio.sleep(interval)
                continue

            await _worker_process_job(
                config,
                atlas_url=resolved_atlas_url,
                session=session,
                token=token,
                job=job,
                search_api_key=resolved_search_key,
                lease_seconds=lease_seconds,
            )
        except Exception as exc:
            _write_worker_state(
                mode="error",
                current_job_id=None,
                last_error=str(exc),
                last_heartbeat_at=_now_iso(),
            )
            await asyncio.sleep(interval)

    _write_stopped_worker_state()


def _spawn_worker_process(
    *,
    config_path: Path,
    debug: bool,
    atlas_url: str | None,
    search_api_key: str,
    interval: int,
    lease_seconds: int,
) -> subprocess.Popen[bytes]:
    """Launch the Atlas worker loop as a detached process."""
    command = [sys.executable, "-m", "atlas_scout.cli", "--config", str(config_path)]
    if debug:
        command.append("--debug")
    command.extend(["worker", "run-internal", "--interval", str(interval)])
    command.extend(["--lease-seconds", str(lease_seconds)])
    if atlas_url:
        command.extend(["--atlas-url", atlas_url])
    if search_api_key:
        command.extend(["--search-api-key", search_api_key])
    env = os.environ.copy()
    if search_api_key:
        env["SEARCH_API_KEY"] = search_api_key
    return subprocess.Popen(
        command,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


async def _worker_start(
    config: ScoutConfig,
    *,
    config_path: Path,
    debug: bool,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Start the local Atlas worker process."""
    _ = config
    session = _load_session_or_click_exception()
    if session is None:
        raise click.ClickException("Log in with `scout login` before starting the worker.")
    _prepare_local_model_config(config, config_path=config_path)
    _require_local_worker_provider(config)
    state = _read_worker_state()
    if _worker_state_running(state):
        raise click.ClickException(f"Scout worker is already running (PID {state['process_id']}).")
    resolved_search_key = resolve_search_api_key(search_api_key)
    process = _spawn_worker_process(
        config_path=config_path,
        debug=debug,
        atlas_url=atlas_url,
        search_api_key=resolved_search_key,
        interval=interval,
        lease_seconds=lease_seconds,
    )
    _write_worker_state(
        status="running",
        mode="starting",
        process_id=process.pid,
        atlas_url=(atlas_url or session.atlas_url).rstrip("/"),
        worker_id=session.worker_id,
        worker_name=session.worker_name or _default_worker_name(),
        search_key_configured=bool(resolved_search_key),
        started_at=_now_iso(),
        current_job_id=None,
    )
    console.print(f"[bold green]Worker started.[/] PID {process.pid}")


async def _worker_stop() -> None:
    """Stop the tracked Atlas worker process."""
    state = _read_worker_state()
    process_id = state.get("process_id")
    if not _worker_state_running(state):
        _write_stopped_worker_state()
        console.print("[yellow]Worker is not running.[/]")
        return
    if not isinstance(process_id, int):
        _write_stopped_worker_state()
        console.print("[yellow]Worker metadata had no PID. State reconciled.[/]")
        return
    with contextlib.suppress(ProcessLookupError):
        _signal_daemon_process(process_id)
    _write_stopped_worker_state()
    console.print(f"[bold green]Worker stopped.[/] PID {process_id}")


def _worker_status() -> None:
    """Print the tracked Atlas worker status."""
    state = _read_worker_state()
    if state.get("status") == "running" and not _worker_state_running(state):
        state = {**state, "status": "stale"}

    console.print("[bold]Scout worker[/]")
    console.print(f"  State: {state.get('status', 'stopped')}")
    if state.get("mode"):
        console.print(f"  Mode: {state['mode']}")
    if state.get("worker_name"):
        console.print(f"  Worker: {state['worker_name']}")
    if isinstance(state.get("process_id"), int):
        console.print(f"  PID: {state['process_id']}")
    if state.get("atlas_url"):
        console.print(f"  Atlas: {state['atlas_url']}")
    configured = "yes" if state.get("search_key_configured") else "no"
    console.print(f"  Search-backed discovery: {configured}")
    if state.get("current_job_id"):
        console.print(f"  Current job: {state['current_job_id']}")
    if state.get("last_completed_job_id"):
        console.print(f"  Last completed job: {state['last_completed_job_id']}")
    if state.get("last_heartbeat_at"):
        console.print(f"  Last heartbeat: {str(state['last_heartbeat_at'])[:19]}")
    if state.get("last_error"):
        console.print(f"  Last error: {state['last_error']}")


@main.group("worker")
def worker_group() -> None:
    """Manage the Atlas worker process."""


@worker_group.command("start")
@click.option("--atlas-url", default=None, help="Atlas app URL. Defaults to the saved login.")
@click.option(
    "--search-api-key",
    default=None,
    envvar="SEARCH_API_KEY",
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option("--interval", default=10, show_default=True, help="Idle poll interval in seconds.")
@click.option("--lease-seconds", default=900, show_default=True, help="Worker job lease seconds.")
@click.pass_context
def worker_start(
    ctx: click.Context,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Start this computer as an Atlas worker."""
    try:
        _run_async(
            _worker_start(
                ctx.obj["config"],
                config_path=ctx.obj["config_path"],
                debug=bool(ctx.obj.get("debug")),
                atlas_url=atlas_url,
                search_api_key=search_api_key,
                interval=interval,
                lease_seconds=lease_seconds,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


@worker_group.command("stop")
def worker_stop() -> None:
    """Stop the tracked Atlas worker process."""
    _run_async(_worker_stop())


@worker_group.command("status")
def worker_status() -> None:
    """Show the tracked Atlas worker state."""
    _worker_status()


@worker_group.command("run-internal", hidden=True)
@click.option("--atlas-url", default=None)
@click.option("--search-api-key", default=None, envvar="SEARCH_API_KEY")
@click.option("--interval", default=10)
@click.option("--lease-seconds", default=900)
@click.pass_context
def worker_run_internal(
    ctx: click.Context,
    atlas_url: str | None,
    search_api_key: str | None,
    interval: int,
    lease_seconds: int,
) -> None:
    """Run the foreground Atlas worker loop."""
    try:
        _run_async(
            _worker_run_internal(
                ctx.obj["config"],
                atlas_url=atlas_url,
                search_api_key=search_api_key,
                interval=interval,
                lease_seconds=lease_seconds,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


# ---------------------------------------------------------------------------
# entries commands
# ---------------------------------------------------------------------------


@main.group()
def entries() -> None:
    """Browse discovered entries."""


@entries.command("stats")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.option(
    "--require-type",
    "required_types",
    multiple=True,
    help="Fail unless this entry type exists. Repeat for multiple types.",
)
@click.option(
    "--min-source-backed",
    type=click.IntRange(0),
    default=None,
    help="Fail unless at least this many entries have source provenance.",
)
@click.option("--run-id", default=None, help="Restrict stats to one local run.")
@click.option(
    "--exclude-source-dataset",
    "excluded_source_datasets",
    multiple=True,
    help="Ignore entries tagged with this source_dataset. Repeat for multiple datasets.",
)
@click.option(
    "--min-people",
    type=click.IntRange(0),
    default=None,
    help="Fail unless at least this many person entries remain after filters.",
)
@click.pass_context
def entries_stats(
    ctx: click.Context,
    json_output: bool,
    required_types: tuple[str, ...],
    min_source_backed: int | None,
    run_id: str | None,
    excluded_source_datasets: tuple[str, ...],
    min_people: int | None,
) -> None:
    """Show aggregate entry counts for discovery verification."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        entries_stats_command(
            config,
            json_output,
            required_types,
            min_source_backed,
            run_id=run_id,
            excluded_source_datasets=excluded_source_datasets,
            min_people=min_people,
        )
    )


@entries.command("purge")
@click.option("--source-dataset", required=True, help="Delete entries tagged with this dataset.")
@click.option("--yes", is_flag=True, help="Confirm deletion.")
@click.option("--dry-run", is_flag=True, help="Count matching entries without deleting them.")
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def entries_purge(
    ctx: click.Context,
    source_dataset: str,
    yes: bool,
    dry_run: bool,
    json_output: bool,
) -> None:
    """Delete active entries matching a source dataset marker."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        entries_purge_command(
            config,
            source_dataset=source_dataset,
            yes=yes,
            dry_run=dry_run,
            json_output=json_output,
        )
    )


@entries.command("list")
@click.option("--min-score", default=0.0, type=float)
@click.option("--type", "entry_type", default=None)
@click.option("--limit", default=50, show_default=True)
@click.option("--run-id", default=None, help="Restrict entries to one local run.")
@click.option("--random", "random_sample", is_flag=True, help="Return a random sample.")
@click.option(
    "--format", "-o", "output_format", type=click.Choice(["table", "json", "csv"]), default="table"
)
@click.pass_context
def entries_list(
    ctx: click.Context,
    min_score: float,
    entry_type: str | None,
    limit: int,
    run_id: str | None,
    random_sample: bool,
    output_format: str,
) -> None:
    """List all discovered entries."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        _entries_list(
            config,
            min_score,
            entry_type,
            limit,
            output_format,
            run_id=run_id,
            random_sample=random_sample,
        )
    )


async def _entries_list(
    config: ScoutConfig,
    min_score: float,
    entry_type: str | None,
    limit: int,
    output_format: str,
    *,
    run_id: str | None = None,
    random_sample: bool = False,
) -> None:
    """Fetch and display entries in the requested format."""
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        console.print("[dim]No entries yet. Run 'scout run' first.[/]")
        return
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        all_entries = await store.list_entries(run_id=run_id, min_score=min_score)
    finally:
        await store.close()
    if entry_type:
        all_entries = [e for e in all_entries if e["entry_type"] == entry_type]
    normalized_limit = max(0, limit)
    shown = (
        random.sample(all_entries, min(normalized_limit, len(all_entries)))
        if random_sample
        else all_entries[:normalized_limit]
    )
    if not shown:
        if output_format == "json":
            click.echo("[]")
        elif output_format != "csv":
            console.print("[dim]No entries found.[/]")
        return

    if output_format == "json":
        rows = [
            {
                "run_id": e.get("run_id"),
                "name": e["name"],
                "entry_type": e["entry_type"],
                "description": e.get("description", ""),
                "city": e.get("city"),
                "state": e.get("state"),
                "score": e["score"],
                "website": e.get("data", {}).get("website"),
                "email": e.get("data", {}).get("email"),
                "issue_areas": e.get("data", {}).get("issue_areas", []),
                "source_urls": e.get("data", {}).get("source_urls", []),
                "source_contexts": e.get("data", {}).get("source_contexts", {}),
                "source_context": e.get("data", {}).get("source_context"),
                "source_dataset": e.get("data", {}).get("source_dataset"),
            }
            for e in shown
        ]
        click.echo(json.dumps(rows, indent=2))
        return

    if output_format == "csv":
        fields = [
            "name",
            "entry_type",
            "description",
            "city",
            "state",
            "score",
            "website",
            "email",
            "issue_areas",
        ]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields)
        writer.writeheader()
        for e in shown:
            data = e.get("data", {})
            writer.writerow(
                {
                    "name": e["name"],
                    "entry_type": e["entry_type"],
                    "description": e.get("description", ""),
                    "city": e.get("city") or "",
                    "state": e.get("state") or "",
                    "score": f"{e['score']:.2f}",
                    "website": data.get("website") or "",
                    "email": data.get("email") or "",
                    "issue_areas": ";".join(data.get("issue_areas", [])),
                }
            )
        click.echo(buf.getvalue(), nl=False)
        return

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Score", style="bold", width=6, justify="right")
    table.add_column("Type", style="dim")
    table.add_column("Name")
    table.add_column("Location")
    for e in shown:
        table.add_row(
            f"{e['score']:.2f}",
            e["entry_type"],
            e["name"],
            f"{e.get('city') or '?'}, {e.get('state') or '?'}",
        )
    console.print(table)
    if len(all_entries) > limit:
        console.print(f"\n[dim]... and {len(all_entries) - limit} more (--limit to show more)[/]")


# ---------------------------------------------------------------------------
# pages commands
# ---------------------------------------------------------------------------


@main.group()
def pages() -> None:
    """Browse scraped pages."""


@pages.command("list")
@click.option("--limit", default=50, show_default=True)
@click.pass_context
def pages_list(ctx: click.Context, limit: int) -> None:
    """List all scraped pages with status."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(_pages_list(config, limit))


async def _pages_list(config: ScoutConfig, limit: int) -> None:
    """Fetch and print page tracking data."""
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        console.print("[dim]No pages yet.[/]")
        return
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        tasks = await store.list_all_page_tasks(limit=limit)
        if not tasks:
            cached = await store.list_pages(limit=limit)
            if not cached:
                console.print("[dim]No pages yet.[/]")
                return
            table = Table(show_lines=False, pad_edge=False)
            table.add_column("Fetched", style="dim")
            table.add_column("Title")
            table.add_column("URL", style="dim")
            for p in cached:
                title = (p["metadata"].get("title") or "—")[:38]
                table.add_row(p["fetched_at"][:19], title, p["url"])
            console.print(table)
            return
    finally:
        await store.close()

    table = Table(show_lines=False, pad_edge=False)
    table.add_column("Status")
    table.add_column("Detail")
    table.add_column("URL", style="dim")
    for t in tasks:
        detail = ""
        if t["entries_extracted"]:
            detail = f"{t['entries_extracted']} entries"
        elif t.get("error"):
            detail = t["error"]
        table.add_row(styled_status(t["status"]), detail, t["url"])
    console.print(table)


@main.group()
def daemon() -> None:
    """Manage the local Scout daemon."""


@daemon.command("start")
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option(
    "--interval", default=0, help="Override interval in seconds (0 = use cron from config)"
)
@click.pass_context
def daemon_start(ctx: click.Context, search_api_key: str | None, interval: int) -> None:
    """Start the scheduler as a local background daemon."""
    config: ScoutConfig = ctx.obj["config"]
    resolved_search_key = (
        _require_search_connection(search_api_key) if config.schedule.targets else ""
    )
    try:
        _run_async(
            _daemon_start(
                config,
                config_path=ctx.obj["config_path"],
                profile_name=ctx.obj.get("profile_name"),
                debug=bool(ctx.obj.get("debug")),
                search_api_key=resolved_search_key,
                interval=interval,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


@daemon.command("stop")
@click.pass_context
def daemon_stop(ctx: click.Context) -> None:
    """Stop the tracked local background daemon process."""
    config: ScoutConfig = ctx.obj["config"]
    try:
        _run_async(_daemon_stop(config))
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


@daemon.command("status")
@click.pass_context
def daemon_status(ctx: click.Context) -> None:
    """Show the tracked local daemon lifecycle state."""
    _run_async(_daemon_status(ctx.obj["config"]))


@daemon.command("run-internal", hidden=True)
@click.option("--search-api-key", envvar="SEARCH_API_KEY", required=True)
@click.option(
    "--interval", default=0, help="Override interval in seconds (0 = use cron from config)"
)
@click.pass_context
def daemon_run_internal(ctx: click.Context, search_api_key: str, interval: int) -> None:
    """Run the hidden daemon scheduler loop."""
    try:
        _run_async(
            _daemon_run_internal(
                ctx.obj["config"],
                config_path=ctx.obj["config_path"],
                profile_name=ctx.obj.get("profile_name"),
                search_api_key=search_api_key,
                interval=interval,
            )
        )
    except click.ClickException as exc:
        _exit_with_error(CliError(title="Error", message=exc.message))


# ---------------------------------------------------------------------------
# schedule — Run discovery on configured schedule targets
# ---------------------------------------------------------------------------


@main.group()
def schedule() -> None:
    """Manage scheduled discovery runs."""


@schedule.command("run-once")
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.pass_context
def schedule_run_once(ctx: click.Context, search_api_key: str | None) -> None:
    """Run all configured schedule targets once."""
    config: ScoutConfig = ctx.obj["config"]
    if not config.schedule.targets:
        console.print("[yellow]No schedule targets configured.[/]")
        console.print("Add targets to your config under [schedule.targets].")
        return
    resolved_search_key = _require_search_connection(search_api_key)
    console.print(f"[bold]Running {len(config.schedule.targets)} targets...[/]")
    run_ids = _run_async(_schedule_run_once(config, resolved_search_key))
    console.print(f"\n[bold green]Completed {len(run_ids)} runs.[/]")
    for rid in run_ids:
        console.print(f"  {rid}")


async def _schedule_run_once(config: ScoutConfig, search_api_key: str) -> list[str]:
    from atlas_scout.scheduler import run_schedule_once

    return await run_schedule_once(config, search_api_key)


@schedule.command("start")
@click.option(
    "--search-api-key",
    envvar="SEARCH_API_KEY",
    default=None,
    help="Automation override for search-backed discovery. Normal use: scout search connect.",
)
@click.option(
    "--interval", default=0, help="Override interval in seconds (0 = use cron from config)"
)
@click.pass_context
def schedule_start(ctx: click.Context, search_api_key: str | None, interval: int) -> None:
    """Start the scheduler loop (runs until interrupted)."""
    config: ScoutConfig = ctx.obj["config"]
    if not config.schedule.targets:
        console.print("[yellow]No schedule targets configured.[/]")
        return
    resolved_search_key = _require_search_connection(search_api_key)
    console.print(f"[bold]Starting scheduler with {len(config.schedule.targets)} targets...[/]")
    console.print("Press Ctrl+C to stop.\n")
    _run_async(_schedule_start(config, resolved_search_key, interval))


async def _schedule_start(config: ScoutConfig, search_api_key: str, interval: int) -> None:
    from atlas_scout.scheduler import run_schedule_loop

    await run_schedule_loop(config, search_api_key, interval_seconds=interval)


if __name__ == "__main__":
    main()
