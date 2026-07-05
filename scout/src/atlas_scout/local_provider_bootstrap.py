"""Provider-level bootstrap actions for local Scout model servers."""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
import webbrowser
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from atlas_scout.local_models import LocalProviderName


class CommandResult(Protocol):
    """Return shape shared by subprocess results used in provider bootstrap."""

    returncode: int


RunCommand = Callable[[Sequence[str]], CommandResult]
StartProcess = Callable[[Sequence[str]], object]
CommandLookup = Callable[[str], str | None]
Sleep = Callable[[float], None]
OpenUrl = Callable[[str], bool | None]


@dataclass(frozen=True, slots=True)
class LocalProviderInstallPlan:
    """One explicit installation action Scout can offer for a local provider."""

    provider: LocalProviderName
    label: str
    command: tuple[str, ...]
    url: str | None


@dataclass(frozen=True, slots=True)
class LocalProviderSpec:
    """Static provider bootstrap metadata."""

    provider: LocalProviderName
    cli_command: str
    label: str
    start_command: tuple[str, ...]
    macos_homebrew_command: tuple[str, ...]
    download_url: str
    download_label: str


LOCAL_PROVIDER_SPECS: tuple[LocalProviderSpec, ...] = (
    LocalProviderSpec(
        provider="ollama",
        cli_command="ollama",
        label="Ollama",
        start_command=("ollama", "serve"),
        macos_homebrew_command=("brew", "install", "ollama"),
        download_url="https://ollama.com/download/mac",
        download_label="Open Ollama installer",
    ),
    LocalProviderSpec(
        provider="lmstudio",
        cli_command="lms",
        label="LM Studio",
        start_command=("lms", "server", "start"),
        macos_homebrew_command=("brew", "install", "--cask", "lm-studio"),
        download_url="https://lmstudio.ai/download",
        download_label="Open LM Studio installer",
    ),
)


def installed_local_model_providers(
    *,
    command_exists: CommandLookup = shutil.which,
) -> tuple[LocalProviderName, ...]:
    """Return providers with installed command-line starters."""
    return tuple(
        spec.provider
        for spec in LOCAL_PROVIDER_SPECS
        if command_exists(spec.cli_command) is not None
    )


def missing_local_model_providers(
    *,
    command_exists: CommandLookup = shutil.which,
) -> tuple[LocalProviderName, ...]:
    """Return providers Scout can help install because their CLI is missing."""
    return tuple(
        spec.provider for spec in LOCAL_PROVIDER_SPECS if command_exists(spec.cli_command) is None
    )


def install_plan_for_provider(
    provider: LocalProviderName,
    *,
    command_exists: CommandLookup = shutil.which,
    platform_name: str = sys.platform,
) -> LocalProviderInstallPlan:
    """Return the best explicit installation action for this computer."""
    spec = _require_provider_spec(provider)
    if platform_name == "darwin" and command_exists("brew") is not None:
        return LocalProviderInstallPlan(
            provider=provider,
            label=f"Install {spec.label} with Homebrew",
            command=spec.macos_homebrew_command,
            url=None,
        )
    return LocalProviderInstallPlan(
        provider=provider,
        label=spec.download_label,
        command=(),
        url=spec.download_url,
    )


def install_local_model_provider(
    plan: LocalProviderInstallPlan,
    *,
    run_command: RunCommand | None = None,
    open_url: OpenUrl = webbrowser.open,
) -> bool:
    """Run a user-confirmed provider installation action."""
    command_runner = run_command or _run_install_command
    if plan.command:
        try:
            return command_runner(plan.command).returncode == 0
        except OSError:
            return False
    if plan.url is not None:
        return bool(open_url(plan.url))
    return False


def start_local_model_server(
    provider: LocalProviderName | str,
    *,
    command_exists: CommandLookup = shutil.which,
    run_command: RunCommand | None = None,
    start_process: StartProcess | None = None,
    sleep: Sleep = time.sleep,
) -> bool:
    """Start an installed local provider server."""
    spec = _provider_spec(provider)
    if spec is None or command_exists(spec.cli_command) is None:
        return False
    command_runner = run_command or _run_server_command
    process_starter = start_process or _start_detached_process
    try:
        if spec.provider == "ollama":
            process_starter(spec.start_command)
            sleep(1)
            return True
        return command_runner(spec.start_command).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _provider_spec(provider: LocalProviderName | str) -> LocalProviderSpec | None:
    normalized = provider.strip().lower()
    return next((spec for spec in LOCAL_PROVIDER_SPECS if spec.provider == normalized), None)


def _require_provider_spec(provider: LocalProviderName) -> LocalProviderSpec:
    spec = _provider_spec(provider)
    if spec is None:
        raise ValueError(f"Unsupported local provider: {provider}")
    return spec


def _run_install_command(command: Sequence[str]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        list(command),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def _run_server_command(command: Sequence[str]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        list(command),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=False,
    )


def _start_detached_process(command: Sequence[str]) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        list(command),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
