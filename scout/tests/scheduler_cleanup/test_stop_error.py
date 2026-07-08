"""Tests for cleanup when stopping the scheduler loop fails."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest

from atlas_scout.scheduler import run_schedule_loop

from .support import (
    FakeFetcher,
    FakeProvider,
    FakeStore,
    build_config,
    build_runtime_profile,
    make_run_result,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_schedule_loop_preserves_stop_error_when_cleanup_also_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = build_config(tmp_path)
    stop_event = asyncio.Event()

    class FakeLifecycle:
        async def mark_started(self, *_: object, **__: object) -> None:
            return None

        async def record_heartbeat(self, *_: object, **__: object) -> None:
            return None

        async def record_tick_complete(self, *_: object, **__: object) -> None:
            stop_event.set()

        async def record_tick_failure(self, *_: object, **__: object) -> None:
            return None

        async def mark_stopped(self, *_: object, **__: object) -> None:
            raise RuntimeError("stop failed")

    async def fake_run_pipeline(**_: object):
        return make_run_result("run-123", entries_found=4, entries_after_dedup=3)

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

    with pytest.raises(RuntimeError, match="stop failed"):
        await run_schedule_loop(
            config,
            "test-search-key",
            interval_seconds=60,
            lifecycle=FakeLifecycle(),
            stop_event=stop_event,
        )
