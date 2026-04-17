"""Tests for adaptive runtime sizing."""

from __future__ import annotations

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import build_runtime_profile


def test_runtime_profile_auto_tunes_local_provider() -> None:
    config = ScoutConfig()
    config.llm.provider = "ollama"
    config.llm.max_concurrent = 0
    config.scraper.max_concurrent_fetches = 0

    profile = build_runtime_profile(config)

    assert profile.cpu_count >= 1
    assert profile.fetch_concurrency >= profile.extract_concurrency
    assert profile.search_concurrency >= 1
    assert profile.extract_concurrency >= 1
    assert profile.url_frontier_queue_size >= profile.fetch_concurrency


def test_runtime_profile_honors_manual_caps() -> None:
    config = ScoutConfig.model_validate(
        {
            "llm": {
                "provider": "anthropic",
                "max_concurrent": 3,
            },
            "scraper": {
                "max_concurrent_fetches": 7,
            },
            "runtime": {
                "max_total_workers": 12,
                "max_memory_percent": 40,
            },
        }
    )

    profile = build_runtime_profile(config)

    assert profile.extract_concurrency == 3
    assert profile.fetch_concurrency == 7
    assert profile.max_total_workers == 12
    assert profile.max_memory_percent == 40


def test_runtime_profile_uses_conservative_ollama_extract_concurrency_for_direct_urls() -> None:
    config = ScoutConfig.model_validate(
        {
            "llm": {
                "provider": "ollama",
                "max_concurrent": 12,
            }
        }
    )

    profile = build_runtime_profile(config, direct_mode=True)

    assert profile.extract_concurrency == 1
