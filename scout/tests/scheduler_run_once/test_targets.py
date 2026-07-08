"""Tests for scheduler one-shot target handling."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.config import ScoutConfig
from atlas_scout.scheduler import run_schedule_once

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
async def test_run_schedule_once_returns_empty_when_no_targets(tmp_path: Path) -> None:
    config = ScoutConfig.model_validate({"store": {"path": str(tmp_path / "scout.db")}})

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == []


@pytest.mark.asyncio
async def test_run_schedule_once_logs_target_exception_from_gather(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If a target task raises after the inner try/except, gather captures it."""
    config = build_config(tmp_path)

    class LoggingProvider(FakeProvider):
        async def close(self) -> None:
            return None

    class LoggingFetcher(FakeFetcher):
        async def close(self) -> None:
            raise RuntimeError("fetcher close failed")

    class LoggingStore(FakeStore):
        async def close(self) -> None:
            return None

    async def fake_run_pipeline(**_: object):
        return make_run_result("run-1")

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, **_kwargs: LoggingProvider(),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", LoggingFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", LoggingStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", fake_run_pipeline)

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == []


@pytest.mark.asyncio
async def test_run_schedule_targets_records_failure_when_target_raises(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Per-target failures should be logged but not abort the overall run set."""
    config = build_config(tmp_path)

    class TargetProvider(FakeProvider):
        async def close(self) -> None:
            return None

    class TargetFetcher(FakeFetcher):
        async def close(self) -> None:
            return None

    class TargetStore(FakeStore):
        async def close(self) -> None:
            return None

    async def boom(**_: object):
        raise RuntimeError("target boom")

    monkeypatch.setattr("atlas_scout.runtime.build_runtime_profile", lambda _: build_runtime_profile())
    monkeypatch.setattr(
        "atlas_scout.providers.create_provider",
        lambda _creds, **_kwargs: TargetProvider(),
    )
    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", TargetFetcher)
    monkeypatch.setattr("atlas_scout.store.ScoutStore", TargetStore)
    monkeypatch.setattr("atlas_scout.pipeline.run_pipeline", boom)

    run_ids = await run_schedule_once(config, "test-search-key")

    assert run_ids == []
