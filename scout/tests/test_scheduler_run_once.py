"""Tests for Scout scheduler one-shot runs."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile
from atlas_scout.scheduler import (
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

    def fake_create_provider(
        llm_config: object, *, max_concurrent: int | None = None
    ) -> FakeProvider:
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
async def test_run_schedule_once_returns_empty_when_no_targets(tmp_path: Path) -> None:
    config = ScoutConfig.model_validate({"store": {"path": str(tmp_path / "scout.db")}})

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == []


# ---------------------------------------------------------------------------
# Cron interval parsing
# ---------------------------------------------------------------------------


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
