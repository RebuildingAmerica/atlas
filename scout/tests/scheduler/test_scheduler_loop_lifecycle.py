"""Lifecycle coverage for Scout scheduler loop behavior."""

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
    make_success_result,
    runtime_profile,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_schedule_loop_records_daemon_lifecycle_until_stop_event(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = make_config(tmp_path)
    stop_event = asyncio.Event()
    store_calls: list[tuple[str, dict[str, object]]] = []

    def on_start(kwargs: dict[str, object]) -> None:
        store_calls.append(("start", dict(kwargs)))

    def on_heartbeat(kwargs: dict[str, object]) -> None:
        store_calls.append(("heartbeat", dict(kwargs)))

    def on_tick(kwargs: dict[str, object]) -> None:
        store_calls.append(("tick", dict(kwargs)))
        stop_event.set()

    def on_stop(kwargs: dict[str, object]) -> None:
        store_calls.append(("stop", dict(kwargs)))

    async def fake_run_pipeline(**_: object):
        return make_success_result()

    async def fake_wait(_: int, __: asyncio.Event | None) -> bool:
        return True

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr(
        "atlas_scout.store.ScoutStore",
        make_store_factory(
            on_start=on_start, on_heartbeat=on_heartbeat, on_tick=on_tick, on_stop=on_stop
        ),
    )
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)
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

    assert store_calls[0][0] == "start"
    assert (
        store_calls[0][1]["config_path"]
        == "/Users/example/.config/atlas-scout/configs/default.toml"
    )
    assert store_calls[0][1]["profile_name"] == "default"
    assert store_calls[0][1]["target_count"] == 1
    assert store_calls[0][1]["started_at"] is not None
    heartbeat_calls = [call for call in store_calls if call[0] == "heartbeat"]
    assert len(heartbeat_calls) == 2
    tick_call = next(call for call in store_calls if call[0] == "tick")
    assert tick_call[1]["status"] == "completed"
    assert tick_call[1]["run_count"] == 1
    assert tick_call[1]["summary"] == "1 scheduled run completed"
    assert tick_call[1]["error"] is None
    assert store_calls[-1][0] == "stop"


@pytest.mark.asyncio
async def test_run_schedule_loop_marks_daemon_stopped_when_cancelled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = make_config(tmp_path)
    tick_started = asyncio.Event()
    blocker = asyncio.Event()
    stop_calls: list[dict[str, object]] = []

    async def fake_run_pipeline(**_: object):
        tick_started.set()
        await blocker.wait()
        return make_success_result()

    async def fake_wait(_: int, __: asyncio.Event | None) -> bool:
        await blocker.wait()
        return True

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr(
        "atlas_scout.store.ScoutStore",
        make_store_factory(on_stop=lambda kwargs: stop_calls.append(dict(kwargs))),
    )
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)
    monkeypatch.setattr("atlas_scout.scheduler._wait_for_next_tick", fake_wait)

    task = asyncio.create_task(
        run_schedule_loop(
            config,
            "test-search-key",
            interval_seconds=60,
            lifecycle=SchedulerDaemonLifecycle(
                config_path="/Users/example/.config/atlas-scout/configs/default.toml",
                profile_name="default",
            ),
        )
    )
    await tick_started.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(stop_calls) == 1
