"""Tests for cleanup during one-off scheduler runs."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest

from atlas_scout.scheduler import run_schedule_loop, run_schedule_once

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
async def test_close_scheduler_resources_logs_when_store_close_fails_after_provider_close_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When both provider and store close raise, the original provider error must propagate."""
    config = build_config(tmp_path)

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, **_kwargs: FakeProvider(close_error="provider close failed"),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr(
        "atlas_scout.store.ScoutStore",
        lambda path: FakeStore(path, close_error="store close failed"),
    )
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", lambda **_: make_run_result("run-1"))

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_once(config, "test-search-key")


@pytest.mark.asyncio
async def test_run_schedule_loop_propagates_cleanup_error_when_no_stop_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When mark_stopped succeeds but resource cleanup fails, the cleanup error must propagate."""
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
            return None

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, **_kwargs: FakeProvider(close_error="provider close failed"),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", FakeStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", lambda **_: make_run_result("run-1"))

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
    config = build_config(tmp_path)

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, **_kwargs: FakeProvider(),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr(
        "atlas_scout.store.ScoutStore",
        lambda path: FakeStore(path, close_error="store close failed"),
    )
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", lambda **_: make_run_result("run-1"))

    with pytest.raises(RuntimeError, match="store close failed"):
        await run_schedule_once(config, "test-search-key")


@pytest.mark.asyncio
async def test_close_scheduler_resources_logs_when_store_close_fails_after_provider_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When both provider and store close raise, the original provider error wins."""
    config = build_config(tmp_path)

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, **_kwargs: FakeProvider(close_error="provider close failed"),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr(
        "atlas_scout.store.ScoutStore",
        lambda path: FakeStore(path, close_error="store close also failed"),
    )
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", lambda **_: make_run_result("run-1"))

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_once(config, "test-search-key")
