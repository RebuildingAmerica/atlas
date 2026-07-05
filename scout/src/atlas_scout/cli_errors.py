"""Structured Scout CLI errors."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CliError:
    """User-facing CLI error data rendered by the presentation layer."""

    title: str
    message: str
    hint: str | None = None
    exit_code: int = 1
