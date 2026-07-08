"""Interactive local model selection helpers for Scout CLI commands."""

from __future__ import annotations

import click
from rich.table import Table

from atlas_scout.cli_context import console
from atlas_scout.cli_select import InteractiveChoice, SelectionCancelledError, select_with_arrows
from atlas_scout.local_models import (
    LocalModelChoice,
    LocalModelResolution,
    LocalProviderName,
    provider_label,
    select_local_model_choice,
)


def _choose_local_model_interactively(
    config,
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
