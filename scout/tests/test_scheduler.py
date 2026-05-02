"""Tests for the Scout scheduler helpers."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile
from atlas_scout.scheduler import (
    SchedulerDaemonLifecycle,
    _completed_tick_summary,
    _cron_to_interval,
    _stop_requested,
    _wait_for_next_tick,
    run_schedule_loop,
    run_schedule_once,
)

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
    assert store_calls[0][1]["config_path"] == "/Users/example/.config/atlas-scout/configs/default.toml"
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
async def test_run_schedule_once_closes_store_when_provider_close_fails(
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
    store_closed = False

    class FakeProvider:
        async def close(self) -> None:
            raise RuntimeError("provider close failed")

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
            nonlocal store_closed
            store_closed = True

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

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_once(config, "test-search-key")

    assert store_closed is True


@pytest.mark.asyncio
async def test_run_schedule_once_closes_provider_when_store_initialize_is_cancelled(
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
    provider_closed = False

    class FakeProvider:
        async def close(self) -> None:
            nonlocal provider_closed
            provider_closed = True

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            raise asyncio.CancelledError

        async def close(self) -> None:
            return None

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

    with pytest.raises(asyncio.CancelledError):
        await run_schedule_once(config, "test-search-key")

    assert provider_closed is True


@pytest.mark.asyncio
async def test_run_schedule_loop_preserves_stop_error_when_cleanup_also_fails(
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

    class FakeProvider:
        async def close(self) -> None:
            raise RuntimeError("provider close failed")

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

    with pytest.raises(RuntimeError, match="stop failed"):
        await run_schedule_loop(
            config,
            "test-search-key",
            interval_seconds=60,
            lifecycle=FakeLifecycle(),
            stop_event=stop_event,
        )


# ---------------------------------------------------------------------------
# run_schedule_once early-return
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_schedule_once_returns_empty_when_no_targets(tmp_path: Path) -> None:
    config = ScoutConfig.model_validate({"store": {"path": str(tmp_path / "scout.db")}})

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == []


# ---------------------------------------------------------------------------
# Cron interval parsing
# ---------------------------------------------------------------------------


def test_cron_to_interval_parses_minute_step() -> None:
    assert _cron_to_interval("*/30 * * * *") == 1800


def test_cron_to_interval_parses_hour_step() -> None:
    assert _cron_to_interval("0 */6 * * *") == 21600


def test_cron_to_interval_short_expression_falls_back_to_daily() -> None:
    assert _cron_to_interval("0 2") == 86400


def test_cron_to_interval_with_invalid_minute_step_falls_back_to_daily() -> None:
    assert _cron_to_interval("*/abc * * * *") == 86400


def test_cron_to_interval_with_invalid_hour_step_falls_back_to_daily() -> None:
    assert _cron_to_interval("0 */xyz * * *") == 86400


def test_cron_to_interval_unrecognized_pattern_falls_back_to_daily() -> None:
    assert _cron_to_interval("0 2 * * *") == 86400


# ---------------------------------------------------------------------------
# _stop_requested
# ---------------------------------------------------------------------------


def test_stop_requested_returns_false_when_no_event() -> None:
    assert _stop_requested(None) is False


def test_stop_requested_returns_false_when_event_unset() -> None:
    assert _stop_requested(asyncio.Event()) is False


def test_stop_requested_returns_true_when_event_set() -> None:
    event = asyncio.Event()
    event.set()
    assert _stop_requested(event) is True


# ---------------------------------------------------------------------------
# _wait_for_next_tick
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wait_for_next_tick_without_stop_event_sleeps_and_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("atlas_scout.scheduler.asyncio.sleep", fake_sleep)

    stopped = await _wait_for_next_tick(7, None)

    assert stopped is False
    assert sleeps == [7]


@pytest.mark.asyncio
async def test_wait_for_next_tick_returns_false_on_timeout() -> None:
    stop_event = asyncio.Event()  # never set
    stopped = await _wait_for_next_tick(0, stop_event)
    assert stopped is False


@pytest.mark.asyncio
async def test_wait_for_next_tick_returns_true_when_stop_event_set() -> None:
    stop_event = asyncio.Event()
    stop_event.set()
    stopped = await _wait_for_next_tick(60, stop_event)
    assert stopped is True


# ---------------------------------------------------------------------------
# _completed_tick_summary
# ---------------------------------------------------------------------------


def test_completed_tick_summary_singular() -> None:
    assert _completed_tick_summary(1) == "1 scheduled run completed"


def test_completed_tick_summary_plural() -> None:
    assert _completed_tick_summary(0) == "0 scheduled runs completed"


# ---------------------------------------------------------------------------
# run_schedule_loop without lifecycle and target failure paths
# ---------------------------------------------------------------------------


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
async def test_close_scheduler_resources_logs_when_store_close_fails_after_provider_close_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When both provider and store close raise, the original provider error must propagate
    and the store-close failure should be logged rather than masked."""
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

    class FakeProvider:
        async def close(self) -> None:
            raise RuntimeError("provider close failed")

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
            raise RuntimeError("store close failed")

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
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

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_once(config, "test-search-key")


@pytest.mark.asyncio
async def test_run_schedule_loop_propagates_cleanup_error_when_no_stop_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When mark_stopped succeeds but resource cleanup fails, the cleanup error must propagate."""
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
            return None

    class FakeProvider:
        async def close(self) -> None:
            raise RuntimeError("provider close failed")

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

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_loop(
            config,
            "test-search-key",
            interval_seconds=60,
            lifecycle=FakeLifecycle(),
            stop_event=stop_event,
        )


@pytest.mark.asyncio
async def test_close_scheduler_resources_propagates_store_error_when_provider_succeeded(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When provider close succeeds but store close fails, the store error must propagate."""
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
            raise RuntimeError("store close failed")

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
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

    with pytest.raises(RuntimeError, match="store close failed"):
        await run_schedule_once(config, "test-search-key")


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


@pytest.mark.asyncio
async def test_close_scheduler_resources_logs_when_store_close_fails_after_provider_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When both provider and store close raise, the original provider error wins."""
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

    class FakeProvider:
        async def close(self) -> None:
            raise RuntimeError("provider close failed")

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
            raise RuntimeError("store close also failed")

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
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

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_once(config, "test-search-key")


@pytest.mark.asyncio
async def test_run_schedule_once_logs_target_exception_from_gather(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If a target task raises after the inner try/except, gather captures it
    and the scheduler logs it without aborting the run."""
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

    class FakeProvider:
        async def close(self) -> None:
            return None

    class FakeFetcher:
        def __init__(self, **_: object) -> None:
            return None

        async def close(self) -> None:
            # _close_if_supported is invoked from the target's `finally` block
            # AFTER the inner try/except has cleared, so this propagates to gather().
            raise RuntimeError("fetcher close failed")

    class FakeStore:
        def __init__(self, path: str) -> None:
            self.path = path

        async def initialize(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def fake_run_pipeline(**_: object) -> SimpleNamespace:
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

    run_ids = await run_schedule_once(config, "test-search-key")

    # Inner try/except returned the run_id, but the finally clause raised — gather
    # captured the raise as the task result, which is logged and skipped. The
    # successful return value never makes it back because gather sees the task
    # ending with an exception, so run_ids stays empty.
    assert run_ids == []


@pytest.mark.asyncio
async def test_run_schedule_targets_records_failure_when_target_raises(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Per-target failures should be logged but not abort the overall run set."""
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

    async def boom(**_: object) -> SimpleNamespace:
        raise RuntimeError("target boom")

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
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", boom)

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == []
