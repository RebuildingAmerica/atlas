"""Tests for the Scout provider factory."""

from __future__ import annotations

import pytest

from atlas_scout.config import LLMConfig
from atlas_scout.providers import create_provider


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
