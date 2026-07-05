"""LLM provider factory for Atlas Scout."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas_scout.config import LLMConfig
    from atlas_scout.providers.base import LLMProvider


def create_provider(
    config: LLMConfig,
    *,
    max_concurrent: int | None = None,
) -> LLMProvider:
    """Instantiate the correct LLM provider from config."""
    effective_max_concurrent = (
        max_concurrent if max_concurrent is not None else config.max_concurrent
    )
    if config.provider == "ollama":
        from atlas_scout.providers.ollama import DEFAULT_OLLAMA_URL, OllamaProvider

        return OllamaProvider(
            model=config.model,
            base_url=config.configured_base_url("ollama") or DEFAULT_OLLAMA_URL,
            max_concurrent=effective_max_concurrent,
            timeout_seconds=config.timeout_seconds,
        )
    if config.provider == "lmstudio":
        from atlas_scout.providers.lmstudio import DEFAULT_LMSTUDIO_URL, LMStudioProvider

        return LMStudioProvider(
            model=config.model,
            base_url=config.configured_base_url("lmstudio") or DEFAULT_LMSTUDIO_URL,
            api_key=config.api_key,
            max_concurrent=effective_max_concurrent,
            timeout_seconds=config.timeout_seconds,
        )
    if config.provider == "anthropic":
        from atlas_scout.providers.anthropic import AnthropicProvider

        return AnthropicProvider(
            model=config.model,
            api_key=config.api_key,  # Can be None; provider falls back to env var
            max_concurrent=effective_max_concurrent,
            timeout_seconds=config.timeout_seconds,
        )
    raise ValueError(f"Unknown LLM provider: {config.provider}")
