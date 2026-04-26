"""Tests for the Scout scheduler helpers."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile
from atlas_scout.scheduler import SchedulerDaemonLifecycle, run_schedule_loop, run_schedule_once

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
