"""Tests for adaptive runtime sizing."""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import _detect_total_memory_bytes, build_runtime_profile

if TYPE_CHECKING:
    import pytest


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


def test_runtime_profile_treats_lmstudio_as_local_provider() -> None:
    config = ScoutConfig.model_validate(
        {
            "llm": {
                "provider": "lmstudio",
                "max_concurrent": 12,
            }
        }
    )

    profile = build_runtime_profile(config)

    assert profile.extract_concurrency == 2


def test_runtime_profile_remote_provider_with_zero_max_concurrent_uses_cpu_default() -> None:
    """When the remote provider config has max_concurrent=0, extract sizing scales with CPU."""
    config = ScoutConfig.model_validate(
        {
            "llm": {
                "provider": "anthropic",
                "max_concurrent": 0,
            },
            "scraper": {
                "max_concurrent_fetches": 5,
            },
        }
    )

    profile = build_runtime_profile(config)

    assert profile.extract_concurrency >= 4
    assert profile.extract_concurrency <= 32


def test_runtime_profile_honors_manual_search_concurrency_cap() -> None:
    config = ScoutConfig.model_validate(
        {
            "llm": {"provider": "anthropic", "max_concurrent": 4},
            "scraper": {
                "max_concurrent_fetches": 5,
                "max_concurrent_searches": 3,
            },
        }
    )

    profile = build_runtime_profile(config)

    assert profile.search_concurrency == 3


def test_detect_total_memory_bytes_falls_back_when_sysconf_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When os.sysconf raises OSError/ValueError, fall back to the safe default."""

    def boom(_name: str) -> int:
        raise OSError("no sysconf for you")

    monkeypatch.setattr("atlas_scout.runtime.os.sysconf", boom)

    bytes_detected = _detect_total_memory_bytes()

    # 8 GiB default
    assert bytes_detected == 8 * 1024 * 1024 * 1024


def test_detect_total_memory_bytes_falls_back_when_sysconf_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the platform lacks sysconf entirely, the helper still returns a value."""

    class FakeOS:
        sysconf_names: ClassVar[dict[str, int]] = {}

        def sysconf(self, _name: str) -> int:  # pragma: no cover - never called
            return 0

    monkeypatch.setattr("atlas_scout.runtime.os", FakeOS())

    bytes_detected = _detect_total_memory_bytes()

    assert bytes_detected == 8 * 1024 * 1024 * 1024


def test_detect_total_memory_bytes_falls_back_when_sysconf_returns_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """sysconf returning 0 should not be treated as a valid memory size."""

    def zero(_name: str) -> int:
        return 0

    monkeypatch.setattr("atlas_scout.runtime.os.sysconf", zero)

    bytes_detected = _detect_total_memory_bytes()

    assert bytes_detected == 8 * 1024 * 1024 * 1024
