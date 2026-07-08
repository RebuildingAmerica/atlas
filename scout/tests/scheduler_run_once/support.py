"""Shared helpers for scheduler one-shot tests."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile


def build_config(tmp_path, *, search_depth: str = "standard") -> ScoutConfig:
    return ScoutConfig.model_validate(
        {
            "store": {"path": str(tmp_path / "scout.db")},
            "schedule": {
                "targets": [
                    {
                        "location": "Austin, TX",
                        "issues": ["housing_affordability"],
                        "search_depth": search_depth,
                    }
                ]
            },
        }
    )


def build_runtime_profile() -> RuntimeProfile:
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


class FakeProvider:
    def __init__(self, *, close_error: str | None = None) -> None:
        self.close_error = close_error
        self.closed = False

    async def close(self) -> None:
        self.closed = True
        if self.close_error is not None:
            raise RuntimeError(self.close_error)


class FakeFetcher:
    def __init__(self, **kwargs: object) -> None:
        self.init_kwargs = kwargs
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class FakeStore:
    def __init__(self, path: str, *, close_error: str | None = None, cancel_initialize: bool = False) -> None:
        self.path = path
        self.close_error = close_error
        self.cancel_initialize = cancel_initialize

    async def initialize(self) -> None:
        if self.cancel_initialize:
            raise asyncio.CancelledError

    async def close(self) -> None:
        if self.close_error is not None:
            raise RuntimeError(self.close_error)


def make_run_result(run_id: str, entries_found: int = 0, entries_after_dedup: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        run_id=run_id,
        entries_found=entries_found,
        entries_after_dedup=entries_after_dedup,
    )
