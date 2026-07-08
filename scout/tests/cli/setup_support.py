"""Shared helpers for setup command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_scout.local_models import LocalModelChoice, LocalModelResolution

if TYPE_CHECKING:
    from collections.abc import Callable


def resolution(*, ready: bool = True) -> LocalModelResolution:
    return LocalModelResolution(
        ready=ready,
        provider="lmstudio" if ready else None,
        model="qwen3:latest" if ready else None,
        base_url="http://localhost:1234/v1" if ready else None,
        message="Using LM Studio with qwen3:latest." if ready else "No local model is ready.",
        remediation=None if ready else "Start Ollama or LM Studio, then run `scout config model`.",
        changed=ready,
    )


def ollama_resolution() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="deepseek-r1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with deepseek-r1:8b.",
        changed=True,
        choices=(
            LocalModelChoice(
                provider="ollama",
                model="deepseek-r1:8b",
                base_url="http://localhost:11434",
            ),
        ),
    )


def multi_model_resolution() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="deepseek-r1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with deepseek-r1:8b.",
        changed=True,
        choices=(
            LocalModelChoice(
                provider="ollama",
                model="deepseek-r1:8b",
                base_url="http://localhost:11434",
            ),
            LocalModelChoice(
                provider="ollama",
                model="llama3.2:latest",
                base_url="http://localhost:11434",
            ),
        ),
    )


def cross_provider_resolution() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="deepseek-r1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with deepseek-r1:8b.",
        changed=True,
        choices=(
            LocalModelChoice(
                provider="ollama",
                model="deepseek-r1:8b",
                base_url="http://localhost:11434",
            ),
            LocalModelChoice(
                provider="lmstudio",
                model="qwen3:latest",
                base_url="http://localhost:1234/v1",
            ),
        ),
    )


def record_started_provider(started_providers: list[str]) -> Callable[[str], bool]:
    def start(provider: str) -> bool:
        started_providers.append(provider)
        return True

    return start
