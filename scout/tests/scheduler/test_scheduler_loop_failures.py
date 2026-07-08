"""Failure-path coverage for Scout scheduler loop behavior."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest

from atlas_scout.scheduler import SchedulerDaemonLifecycle, run_schedule_loop

from .scheduler_loop_support import (
    FakeFetcher,
    FakeProvider,
    make_config,
    make_store_factory,
    runtime_profile,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_schedule_loop_records_failed_tick_summary(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = make_config(tmp_path)
    stop_event = asyncio.Event()
    tick_calls: list[dict[str, object]] = []

    async def fake_run_schedule_targets(_: object) -> list[str]:
        raise RuntimeError("pipeline boom")

    async def fake_wait(_: int, __: asyncio.Event | None) -> bool:
        return True

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr(
        "atlas_scout.store.ScoutStore",
        make_store_factory(on_tick=lambda kwargs: tick_calls.append(dict(kwargs))),
    )
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", fake_run_schedule_targets)
    monkeypatch.setattr("atlas_scout.scheduler._wait_for_next_tick", fake_wait)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=60,
        lifecycle=SchedulerDaemonLifecycle(
            config_path="/Users/example/.config/atlas-scout/configs/default.toml",
            profile_name="default",
        ),
        stop_event=stop_event,
    )

    assert len(tick_calls) == 1
    assert tick_calls[0]["status"] == "failed"
    assert tick_calls[0]["run_count"] == 0
    assert tick_calls[0]["summary"] == "Scheduler tick failed: pipeline boom"
    assert tick_calls[0]["error"] == "pipeline boom"


@pytest.mark.asyncio
async def test_run_schedule_loop_without_lifecycle_uses_cron_when_interval_zero(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = make_config(tmp_path, cron="*/30 * * * *")
    stop_event = asyncio.Event()

    async def fake_run_pipeline(**_: object):
        stop_event.set()
        return type(
            "Result", (), {"run_id": "run-1", "entries_found": 0, "entries_after_dedup": 0}
        )()

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", make_store_factory())
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=0,
        stop_event=stop_event,
    )


@pytest.mark.asyncio
async def test_run_schedule_loop_without_lifecycle_handles_pipeline_error_and_breaks_on_stop(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = make_config(tmp_path)
    stop_event = asyncio.Event()

    async def boom(_: object) -> list[str]:
        stop_event.set()
        raise RuntimeError("scheduler tick exploded")

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", make_store_factory())
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", boom)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=60,
        stop_event=stop_event,
    )
