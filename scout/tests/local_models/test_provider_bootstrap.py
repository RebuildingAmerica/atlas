"""Local provider bootstrap execution tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas_scout.local_provider_bootstrap import (
    LocalProviderInstallPlan,
    install_local_model_provider,
    install_plan_for_provider,
    installed_local_model_providers,
    start_local_model_server,
)

if TYPE_CHECKING:
    from collections.abc import Sequence


@dataclass(frozen=True, slots=True)
class _CompletedProcess:
    returncode: int


class _CommandLookup:
    def __init__(self, *commands: str) -> None:
        self.commands = set(commands)

    def __call__(self, command: str) -> str | None:
        if command in self.commands:
            return f"/usr/local/bin/{command}"
        return None


def test_installed_provider_detection_uses_provider_commands() -> None:
    providers = installed_local_model_providers(command_exists=_CommandLookup("lms"))

    assert providers == ("lmstudio",)


def test_install_plan_uses_macos_homebrew_when_available() -> None:
    plan = install_plan_for_provider(
        "lmstudio",
        command_exists=_CommandLookup("brew"),
        platform_name="darwin",
    )

    assert plan == LocalProviderInstallPlan(
        provider="lmstudio",
        label="Install LM Studio with Homebrew",
        command=("brew", "install", "--cask", "lm-studio"),
        url=None,
    )


def test_install_plan_uses_download_page_without_headless_installer() -> None:
    plan = install_plan_for_provider(
        "ollama",
        command_exists=_CommandLookup(),
        platform_name="darwin",
    )

    assert plan == LocalProviderInstallPlan(
        provider="ollama",
        label="Open Ollama installer",
        command=(),
        url="https://ollama.com/download/mac",
    )


def test_install_provider_runs_confirmed_command() -> None:
    commands: list[Sequence[str]] = []
    plan = LocalProviderInstallPlan(
        provider="lmstudio",
        label="Install LM Studio with Homebrew",
        command=("brew", "install", "--cask", "lm-studio"),
        url=None,
    )

    def run(command: Sequence[str]) -> _CompletedProcess:
        commands.append(command)
        return _CompletedProcess(returncode=0)

    assert install_local_model_provider(plan, run_command=run, open_url=lambda _url: False)
    assert commands == [("brew", "install", "--cask", "lm-studio")]


def test_install_provider_opens_download_page_when_no_command_exists() -> None:
    opened_urls: list[str] = []
    plan = LocalProviderInstallPlan(
        provider="ollama",
        label="Open Ollama installer",
        command=(),
        url="https://ollama.com/download/mac",
    )

    def open_url(url: str) -> bool:
        opened_urls.append(url)
        return True

    assert install_local_model_provider(
        plan,
        run_command=lambda _command: _CompletedProcess(1),
        open_url=open_url,
    )
    assert opened_urls == ["https://ollama.com/download/mac"]


def test_start_lmstudio_uses_lms_server_start() -> None:
    commands: list[Sequence[str]] = []

    def run(command: Sequence[str]) -> _CompletedProcess:
        commands.append(command)
        return _CompletedProcess(returncode=0)

    assert start_local_model_server(
        "lmstudio",
        command_exists=_CommandLookup("lms"),
        run_command=run,
    )
    assert commands == [("lms", "server", "start")]


def test_start_ollama_uses_ollama_serve() -> None:
    commands: list[Sequence[str]] = []

    def start_process(command: Sequence[str]) -> object:
        commands.append(command)
        return object()

    assert start_local_model_server(
        "ollama",
        command_exists=_CommandLookup("ollama"),
        start_process=start_process,
        sleep=lambda _seconds: None,
    )
    assert commands == [("ollama", "serve")]


def test_start_unknown_provider_fails() -> None:
    provider = "other"

    assert not start_local_model_server(
        provider,
        command_exists=_CommandLookup("other"),
    )
