"""Tests for the Scout scheduler helpers."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile
from atlas_scout.scheduler import run_schedule_once

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_schedule_once_uses_runtime_profile_and_provider_override(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "deep",
                    }
                ]
            },
        }
    )
    profile = RuntimeProfile(
        cpu_count=8,
        total_memory_bytes=16 * 1024 * 1024 * 1024,
        max_memory_percent=70,
        max_total_workers=64,
        search_concurrency=7,
        fetch_concurrency=11,
        extract_concurrency=2,
        url_frontier_queue_size=500,
        fetched_page_queue_size=100,
    )
    provider_calls: list[dict[str, object]] = []
    fetcher_inits: list[dict[str, object]] = []
    pipeline_calls: list[dict[str, object]] = []

    class FakeProvider:
        def __init__(self) -> None:
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    class FakeFetcher:
        def __init__(self, **kwargs: object) -> None:
            fetcher_inits.append(kwargs)
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path
            self.initialized = False
            self.closed = False

        async def initialize(self) -> None:
            self.initialized = True

        async def close(self) -> None:
            self.closed = True

    async def fake_run_pipeline(**kwargs: object) -> SimpleNamespace:
        pipeline_calls.append(kwargs)
        return SimpleNamespace(
            run_id="run-123",
            entries_found=4,
            entries_after_dedup=3,
        )

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return profile

    def fake_create_provider(llm_config: object, *, max_concurrent: int | None = None) -> FakeProvider:
        provider_calls.append(
            {
                "config": llm_config,
                "max_concurrent": max_concurrent,
            }
        )
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == ["run-123"]
    assert provider_calls == [{"config": config.llm, "max_concurrent": 2}]
    assert fetcher_inits[0]["max_concurrent"] == 11
    assert pipeline_calls[0]["search_concurrency"] == 7
    assert pipeline_calls[0]["search_depth"] == "deep"
