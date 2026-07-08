"""Shared helpers for Scout CLI tests."""

from __future__ import annotations

from atlas_scout.local_models import LocalModelResolution

__all__ = ["_ready_local_model_resolution"]


def _ready_local_model_resolution() -> LocalModelResolution:
    """Return a ready local model for CLI tests with a stubbed run pipeline."""
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="llama3.1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with llama3.1:8b.",
    )
