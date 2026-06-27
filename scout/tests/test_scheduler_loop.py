"""Tests for Scout scheduler loop behavior."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile
from atlas_scout.scheduler import (
    SchedulerDaemonLifecycle,
    run_schedule_loop,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_schedule_loop_records_daemon_lifecycle_until_stop_event(
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
                        "search_depth": "standard",
                    }
                ]
            },
        }
    )
    stop_event = asyncio.Event()
    store_calls: list[tuple[str, dict[str, object]]] = []

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

        async def start_daemon(self, **kwargs: object) -> None:
            store_calls.append(("start", dict(kwargs)))

        async def record_daemon_heartbeat(self, **kwargs: object) -> None:
            store_calls.append(("heartbeat", dict(kwargs)))

        async def record_daemon_tick_result(self, **kwargs: object) -> None:
            store_calls.append(("tick", dict(kwargs)))
            stop_event.set()

        async def stop_daemon(self, **kwargs: object) -> None:
            store_calls.append(("stop", dict(kwargs)))

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
        return SimpleNamespace(
            run_id="run-123",
            entries_found=4,
            entries_after_dedup=3,
        )

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

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
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "standard",
                    }
                ]
            },
        }
    )
    tick_started = asyncio.Event()
    blocker = asyncio.Event()
    stop_calls: list[dict[str, object]] = []

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

        async def start_daemon(self, **_: object) -> None:
            return None

        async def record_daemon_heartbeat(self, **_: object) -> None:
            return None

        async def record_daemon_tick_result(self, **_: object) -> None:
            return None

        async def stop_daemon(self, **kwargs: object) -> None:
            stop_calls.append(dict(kwargs))

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
        tick_started.set()
        await blocker.wait()
        return SimpleNamespace(
            run_id="run-123",
            entries_found=4,
            entries_after_dedup=3,
        )

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

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


@pytest.mark.asyncio
async def test_run_schedule_loop_records_failed_tick_summary(
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
                        "search_depth": "standard",
                    }
                ]
            },
        }
    )
    stop_event = asyncio.Event()
    tick_calls: list[dict[str, object]] = []

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

        async def start_daemon(self, **_: object) -> None:
            return None

        async def record_daemon_heartbeat(self, **_: object) -> None:
            return None

        async def record_daemon_tick_result(self, **kwargs: object) -> None:
            tick_calls.append(dict(kwargs))
            stop_event.set()

        async def stop_daemon(self, **_: object) -> None:
            return None

    async def fake_run_schedule_targets(_: object) -> list[str]:
        raise RuntimeError("pipeline boom")

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        assert max_concurrent == 2
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", fake_run_schedule_targets)

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
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "cron": "*/30 * * * *",
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "standard",
                    }
                ],
            },
        }
    )
    stop_event = asyncio.Event()

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
        stop_event.set()
        return SimpleNamespace(run_id="run-1", entries_found=0, entries_after_dedup=0)

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
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
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "standard",
                    }
                ],
            },
        }
    )
    stop_event = asyncio.Event()

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def boom(_: object) -> list[str]:
        stop_event.set()
        raise RuntimeError("scheduler tick exploded")

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", boom)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=60,
        stop_event=stop_event,
    )


@pytest.mark.asyncio
async def test_run_schedule_loop_breaks_when_wait_returns_stop(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If _wait_for_next_tick observes a stop, the loop must exit."""
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "standard",
                    }
                ],
            },
        }
    )

    stop_event = asyncio.Event()

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def fake_targets(_: object) -> list[str]:
        return ["run-x"]

    waits: list[bool] = []

    async def fake_wait(seconds: int, evt: asyncio.Event | None) -> bool:
        del seconds
        waits.append(True)
        # Signal stop via the event so the second _stop_requested check exits cleanly.
        if evt is not None:
            evt.set()
        return True

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
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
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "standard",
                    }
                ]
            },
        }
    )
    stop_event = asyncio.Event()
    stop_event.set()
    pipeline_calls = 0

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
        nonlocal pipeline_calls
        pipeline_calls += 1
        return SimpleNamespace(run_id="run-1", entries_found=0, entries_after_dedup=0)

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
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
    config = ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": "standard",
                    }
                ]
            },
        }
    )
    stop_event = asyncio.Event()
    target_calls = 0

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            return None

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def fake_targets(_: object) -> list[str]:
        nonlocal target_calls
        target_calls += 1
        if target_calls >= 2:
            stop_event.set()
        return ["run-x"]

    async def fake_wait(seconds: int, evt: asyncio.Event | None) -> bool:
        del seconds, evt
        return False  # always "timed out", loop should continue

    def fake_build_runtime_profile(_: ScoutConfig) -> RuntimeProfile:
        return RuntimeProfile(
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

    def fake_create_provider(_: object, *, max_concurrent: int | None = None) -> FakeProvider:
        del max_concurrent
        return FakeProvider()

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", fake_build_runtime_profile)
    monkeypatch.setattr("atlas_scout.providers.create_provider", fake_create_provider)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.scheduler._run_schedule_targets", fake_targets)
    monkeypatch.setattr("atlas_scout.scheduler._wait_for_next_tick", fake_wait)

    await run_schedule_loop(
        config,
        "test-search-key",
        interval_seconds=60,
        stop_event=stop_event,
    )

    assert target_calls == 2
