"""Shared helpers for daemon coverage tests."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig

if TYPE_CHECKING:
    from pathlib import Path

    import pytest

DEFAULT_CRON = "0 2 * * *"


def _capture_consoles(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
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
