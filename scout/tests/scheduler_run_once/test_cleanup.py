"""Tests for scheduler one-shot cleanup behavior."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from atlas_scout.scheduler import run_schedule_once

from .support import FakeFetcher, FakeProvider, FakeStore, build_config, build_runtime_profile, make_run_result


@pytest.mark.asyncio
async def test_run_schedule_once_closes_store_when_provider_close_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = build_config(tmp_path)
    store_closed = False

    class ClosingStore(FakeStore):
        async def close(self) -> None:
            nonlocal store_closed
            store_closed = True

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, *, max_concurrent=None: FakeProvider(close_error="provider close failed"),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", FakeFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", ClosingStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", lambda **_: make_run_result("run-123", 4, 3))

    with pytest.raises(RuntimeError, match="provider close failed"):
        await run_schedule_once(config, "test-search-key")

    assert store_closed is True


@pytest.mark.asyncio
async def test_run_schedule_once_closes_provider_when_store_initialize_is_cancelled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = build_config(tmp_path)
    provider_closed = False

    class ClosingProvider(FakeProvider):
        async def close(self) -> None:
            nonlocal provider_closed
            provider_closed = True

    class CancellingStore(FakeStore):
        async def initialize(self) -> None:
            raise asyncio.CancelledError

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, *, max_concurrent=None: ClosingProvider(),
    )
    monkeypatch.setattr("atlas_scout.store.ScoutStore", CancellingStore)

    with pytest.raises(asyncio.CancelledError):
        await run_schedule_once(config, "test-search-key")

    assert provider_closed is True
