"""Tests for the Scout provider factory."""

from __future__ import annotations

import pytest

from atlas_scout.config import LLMConfig
from atlas_scout.providers import create_provider
from atlas_scout.providers.anthropic import AnthropicProvider
from atlas_scout.providers.lmstudio import LMStudioProvider
from atlas_scout.providers.ollama import OllamaProvider


@pytest.mark.asyncio
async def test_create_provider_uses_override_max_concurrent() -> None:
    provider = create_provider(
        LLMConfig(provider="ollama", model="qwen3.5:latest", max_concurrent=10),
        max_concurrent=3,
    )
    try:
        assert provider.max_concurrent == 3
    finally:
        await provider.aclose()


@pytest.mark.asyncio
async def test_create_provider_uses_config_max_concurrent_when_no_override() -> None:
    provider = create_provider(
        LLMConfig(provider="ollama", model="qwen3.5:latest", max_concurrent=7),
    )
    try:
        assert isinstance(provider, OllamaProvider)
        assert provider.max_concurrent == 7
    finally:
        await provider.aclose()


@pytest.mark.asyncio
async def test_create_provider_returns_anthropic_provider_for_anthropic_config() -> None:
    provider = create_provider(
        LLMConfig(
            provider="anthropic",
            model="claude-sonnet-4-20250514",
            api_key="test-key",
            max_concurrent=4,
        ),
    )
    try:
        assert isinstance(provider, AnthropicProvider)
        assert provider.max_concurrent == 4
    finally:
        await provider.aclose()


@pytest.mark.asyncio
async def test_create_provider_returns_lmstudio_provider_for_lmstudio_config() -> None:
    provider = create_provider(
        LLMConfig(
            provider="lmstudio",
            model="qwen3:latest",
            base_url="http://studio.test:1234",
            max_concurrent=2,
        ),
    )
    try:
        assert isinstance(provider, LMStudioProvider)
        assert provider.max_concurrent == 2
    finally:
        await provider.aclose()


def test_create_provider_raises_for_unknown_provider() -> None:
    with pytest.raises(ValueError, match="Unknown LLM provider: mistral"):
        create_provider(LLMConfig(provider="mistral", model="something"))
