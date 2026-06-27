"""Tests for Scout scheduler cleanup paths."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile
from atlas_scout.scheduler import (
    run_schedule_loop,
    run_schedule_once,
)

if TYPE_CHECKING:
    from pathlib import Path


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
