"""Local model helpers shared by Scout CLI commands."""

from __future__ import annotations

import tomllib
from typing import TYPE_CHECKING

import click

from atlas_scout.cli_context import console
from atlas_scout.config import ScoutConfig, get_active_profile_name, save_local_model_settings
from atlas_scout.local_model_commands_support import (
    _choose_local_model_interactively,
    _choose_local_model_provider_interactively,
)
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

if TYPE_CHECKING:
    from pathlib import Path

LOCAL_WORKER_PROVIDERS = frozenset(LOCAL_PROVIDER_NAMES)


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
    provider = _choose_setup_local_model_provider(config)
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


def _choose_setup_local_model_provider(config: ScoutConfig) -> LocalProviderName | None:
    """Choose or install a provider before model configuration."""
    installed_providers = _installed_local_model_providers()
    missing_providers = _missing_local_model_providers()
    if len(installed_providers) == 1:
        resolution = resolve_local_model(config)
        missing_with_choices = tuple(
            provider
            for provider in missing_providers
            if any(choice.provider == provider for choice in resolution.choices)
        )
        if not missing_with_choices:
            return installed_providers[0]
        missing_providers = missing_with_choices

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


def _apply_and_persist_local_model(
    config_path: Path,
    config: ScoutConfig,
    resolution: LocalModelResolution,
) -> None:
    """Apply a ready local model resolution to config, save it, and report the choice."""
    apply_local_model_resolution(config, resolution)
    _save_local_model_config(config_path, config, resolution)
    _print_local_model_resolution(resolution, saved=True)


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
