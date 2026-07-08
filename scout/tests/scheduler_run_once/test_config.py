"""Tests for scheduler one-shot configuration wiring."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.scheduler import run_schedule_once

from .support import FakeFetcher, FakeProvider, FakeStore, build_config, build_runtime_profile

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_schedule_once_uses_runtime_profile_and_provider_override(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = build_config(tmp_path, search_depth="deep")
    profile = build_runtime_profile()
    provider_calls: list[dict[str, object]] = []
    fetcher_inits: list[dict[str, object]] = []
    pipeline_calls: list[dict[str, object]] = []

    class RecordingFetcher(FakeFetcher):
        def __init__(self, **kwargs: object) -> None:
            super().__init__(**kwargs)
            fetcher_inits.append(kwargs)

    async def fake_run_pipeline(**kwargs: object):
        pipeline_calls.append(kwargs)
        from .support import make_run_result

        return make_run_result("run-123", entries_found=4, entries_after_dedup=3)

    def fake_create_provider(llm_config: object, *, max_concurrent: int | None = None) -> FakeProvider:
        provider_calls.append({"config": llm_config, "max_concurrent": max_concurrent})
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", RecordingFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == ["run-123"]
    assert provider_calls == [{"config": config.llm, "max_concurrent": 2}]
    assert fetcher_inits[0]["max_concurrent"] == 11
    assert pipeline_calls[0]["search_concurrency"] == 7
    assert pipeline_calls[0]["search_depth"] == "deep"
