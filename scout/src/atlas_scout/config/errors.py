"""Structured errors for Scout config profile mutations."""

from __future__ import annotations


class ConfigMutationError(ValueError):
    """Raised when a profile config mutation is not safe or valid."""

    def __init__(self, *, title: str, message: str, hint: str | None = None) -> None:
        """Create a user-facing config mutation error."""
        super().__init__(message)
        self.title = title
        self.message = message
        self.hint = hint
