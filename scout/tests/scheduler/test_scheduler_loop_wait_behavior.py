"""Wait/stop control-flow coverage for Scout scheduler loop behavior."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest

from atlas_scout.scheduler import run_schedule_loop

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
async def test_run_schedule_loop_breaks_when_wait_returns_stop(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If _wait_for_next_tick observes a stop, the loop must exit."""
    config = make_config(tmp_path)
    stop_event = asyncio.Event()

    async def fake_targets(_: object) -> list[str]:
        return ["run-x"]

    waits: list[bool] = []

    async def fake_wait(seconds: int, evt: asyncio.Event | None) -> bool:
        del seconds
        waits.append(True)
        if evt is not None:
            evt.set()
        return True

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", make_store_factory())
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", fake_targets)
    monkeypatch.setattr("atlas_scout.scheduler._wait_for_next_tick", fake_wait)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=60,
        stop_event=stop_event,
    )

    assert waits == [True]


@pytest.mark.asyncio
async def test_run_schedule_loop_exits_immediately_when_stop_event_preset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If stop_event is set before the loop begins, the body never executes."""
    config = make_config(tmp_path)
    stop_event = asyncio.Event()
    stop_event.set()
    pipeline_calls = 0

    async def fake_run_pipeline(**_: object):
        nonlocal pipeline_calls
        pipeline_calls += 1
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
        interval_seconds=60,
        stop_event=stop_event,
    )

    assert pipeline_calls == 0


@pytest.mark.asyncio
async def test_run_schedule_loop_continues_for_two_ticks_when_wait_returns_false(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When _wait_for_next_tick returns False (timeout), the loop continues another iteration."""
    config = make_config(tmp_path)
    stop_event = asyncio.Event()
    target_calls = 0

    async def fake_targets(_: object) -> list[str]:
        nonlocal target_calls
        target_calls += 1
        if target_calls >= 2:
            stop_event.set()
        return ["run-x"]

    async def fake_wait(seconds: int, evt: asyncio.Event | None) -> bool:
        del seconds, evt
        return False

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", make_store_factory())
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", fake_targets)
    monkeypatch.setattr("atlas_scout.scheduler._wait_for_next_tick", fake_wait)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=60,
        stop_event=stop_event,
    )

    assert target_calls == 2
