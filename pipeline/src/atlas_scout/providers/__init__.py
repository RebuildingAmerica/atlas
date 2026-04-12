"""LLM provider factory for Atlas Scout."""

from __future__ import annotations

from atlas_scout.config import LLMConfig
from atlas_scout.providers.base import LLMProvider


def create_provider(config: LLMConfig) -> LLMProvider:
    """Instantiate the correct LLM provider from config."""
    if config.provider == "ollama":
        from atlas_scout.providers.ollama import OllamaProvider

        return OllamaProvider(
            model=config.model,
            base_url=config.base_url or "http://localhost:11434",
            max_concurrent=config.max_concurrent,
        )
    if config.provider == "anthropic":
        from atlas_scout.providers.anthropic import AnthropicProvider

        return AnthropicProvider(
            model=config.model,
            api_key=config.base_url,  # Can be None; provider falls back to env var
            max_concurrent=config.max_concurrent,
        )
    raise ValueError(f"Unknown LLM provider: {config.provider}")
