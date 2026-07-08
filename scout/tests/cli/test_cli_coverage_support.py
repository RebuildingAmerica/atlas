"""Shared helpers for Scout CLI coverage tests."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.config import LLMConfig, ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
from atlas_scout.local_models import LocalModelResolution

DEFAULT_CRON = "0 2 * * *"

__all__ = [
    "DEFAULT_CRON",
    "_capture_consoles",
    "_make_config",
    "_scheduled_config",
    "_ready_local_model_resolution",
]


def _capture_consoles(monkeypatch: object) -> io.StringIO:
    """Redirect both module consoles into a single buffer for assertions."""
    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def _make_config(tmp_path: Path, **overrides: Any) -> ScoutConfig:
    """Return a ScoutConfig pinned to a tmp DB."""
    base: dict[str, Any] = {"store": StoreConfig(path=str(tmp_path / "scout.db"))}
    base.update(overrides)
    return ScoutConfig(**base)


def _scheduled_config(tmp_path: Path) -> ScoutConfig:
    """ScoutConfig with one schedule target and tmp DB."""
    return _make_config(
        tmp_path,
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing"])]
        ),
    )


def _ready_local_model_resolution() -> LocalModelResolution:
    """Return a ready local model resolution for CLI tests with a stubbed pipeline."""
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="llama3.1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with llama3.1:8b.",
    )
